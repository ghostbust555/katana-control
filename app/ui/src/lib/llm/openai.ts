// Any server speaking the OpenAI chat/completions API with tool calls: LM Studio, Ollama,
// llama.cpp server, vLLM, OpenRouter, OpenAI itself. Plain fetch + server-sent events.
import { LlmError, type ChatSession, type LlmProvider, type LlmSettings, type ModelInfo, type StepResult, type ToolDef, type ToolResult } from './types'

interface Options {
  id: string
  label: string
  defaultModel: string
  /** Fixed server (OpenRouter); otherwise the URL from the settings. */
  baseUrl?: string
  needsKey: boolean
  hint?: string
  /** Extra request headers (OpenRouter's app attribution). */
  headers?: Record<string, string>
}

const baseOf = (o: Options, s: LlmSettings) => (o.baseUrl || s.baseUrl || 'http://localhost:1234/v1').replace(/\/+$/, '')
const authOf = (s: LlmSettings): Record<string, string> => (s.apiKey ? { authorization: `Bearer ${s.apiKey}` } : {})

type Msg =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[] }
  | { role: 'tool'; tool_call_id: string; content: string }

class OpenAiSession implements ChatSession {
  private history: Msg[]
  private tools: unknown[]

  constructor(private o: Options, private s: LlmSettings, system: string, tools: ToolDef[]) {
    this.history = [{ role: 'system', content: system }]
    this.tools = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.schema } }))
  }

  addUser(parts: string[]) { this.history.push({ role: 'user', content: parts.join('\n\n') }) }
  addToolResults(results: ToolResult[]) {
    for (const r of results) this.history.push({ role: 'tool', tool_call_id: r.id, content: (r.isError ? 'ERROR: ' : '') + r.content })
  }
  mark() { return this.history.length }
  rollback(mark: number) { this.history.length = mark }

  async step({ onText, signal }: { onText: (d: string) => void; signal: AbortSignal }): Promise<StepResult> {
    const base = baseOf(this.o, this.s)
    let res: Response
    try {
      res = await fetch(`${base}/chat/completions`, {
        method: 'POST', signal,
        headers: { 'content-type': 'application/json', ...authOf(this.s), ...this.o.headers },
        body: JSON.stringify({ model: this.s.model || this.o.defaultModel, messages: this.history, tools: this.tools, stream: true }),
      })
    } catch (e) {
      throw signal.aborted ? new LlmError('aborted', 'Stopped.') : new LlmError('network', `Couldn't reach ${base}.`)
    }
    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => '')
      const kind = res.status === 401 || res.status === 403 ? 'auth' : res.status === 429 ? 'rate' : 'other'
      throw new LlmError(kind, `${base} answered ${res.status}: ${body.slice(0, 300)}`)
    }
    let text = ''
    let finish = ''
    const calls: { id: string; name: string; args: string }[] = []
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
    let buf = ''
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buf += value
        let nl
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim()
          buf = buf.slice(nl + 1)
          if (!line.startsWith('data:')) continue
          const data = line.slice(5).trim()
          if (data === '[DONE]') continue
          const choice = JSON.parse(data).choices?.[0]
          if (!choice) continue
          const d = choice.delta ?? {}
          if (d.content) { text += d.content; onText(d.content) }
          for (const tc of d.tool_calls ?? []) {
            const c = (calls[tc.index ?? 0] ??= { id: '', name: '', args: '' })
            if (tc.id) c.id = tc.id
            if (tc.function?.name) c.name += tc.function.name
            if (tc.function?.arguments) c.args += tc.function.arguments
          }
          if (choice.finish_reason) finish = choice.finish_reason
        }
      }
    } catch (e) {
      throw signal.aborted ? new LlmError('aborted', 'Stopped.') : new LlmError('network', `The stream from ${base} broke off.`)
    }
    const list = calls.filter(Boolean).map((c, i) => ({ ...c, id: c.id || `call_${Date.now()}_${i}` }))
    if (finish === 'length' && list.length) return { text, calls: [], stop: 'truncated' }
    this.history.push({
      role: 'assistant', content: text || null,
      ...(list.length ? { tool_calls: list.map((c) => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: c.args } })) } : {}),
    })
    const parsed = list.map((c) => {
      let input: unknown
      try { input = JSON.parse(c.args || '{}') } catch { input = { INVALID_JSON: c.args } }
      return { id: c.id, name: c.name, input }
    })
    return { text, calls: parsed, stop: parsed.length ? 'tools' : 'done' }
  }
}

/** GET /models. OpenRouter adds prices and which models can call tools. */
async function listModels(o: Options, s: LlmSettings): Promise<ModelInfo[]> {
  const base = baseOf(o, s)
  let res: Response
  try {
    res = await fetch(`${base}/models`, { headers: { ...authOf(s), ...o.headers } })
  } catch {
    throw new LlmError('network', `Couldn't reach ${base}.`)
  }
  if (!res.ok) throw new LlmError(res.status === 401 ? 'auth' : 'other', `${base}/models answered ${res.status}`)
  type Raw = { id: string; name?: string; context_length?: number; supported_parameters?: string[]; pricing?: { prompt?: string; completion?: string } }
  const data = ((await res.json()).data ?? []) as Raw[]
  const perM = (x?: string) => {
    const n = Number(x ?? NaN) * 1e6
    return Number.isNaN(n) ? '?' : n === 0 ? 'free' : `$${n < 10 ? n.toFixed(2) : n.toFixed(0)}`
  }
  return data
    .filter((m) => !m.id.endsWith(':batch') && (!m.supported_parameters || m.supported_parameters.includes('tools')))
    .map((m) => ({
      id: m.id,
      name: m.name ?? m.id,
      free: !!m.pricing && Number(m.pricing.prompt) === 0 && Number(m.pricing.completion) === 0,
      ctx: m.context_length ? ` · ${Math.round(m.context_length / 1000)}k context` : '',
      pricing: m.pricing,
    }))
    .map(({ ctx, pricing, ...m }) => ({
      ...m,
      detail: pricing ? (m.free ? 'Free' : `${perM(pricing.prompt)} in / ${perM(pricing.completion)} out per 1M tokens`) + ctx : undefined,
    }))
}

function openAiCompatible(o: Options): LlmProvider {
  return {
    id: o.id, label: o.label, defaultModel: o.defaultModel, needsKey: o.needsKey, needsBaseUrl: !o.baseUrl, hint: o.hint,
    newSession: (s, system, tools) => new OpenAiSession(o, s, system, tools),
    listModels: (s) => listModels(o, s),
  }
}

export const openrouter = openAiCompatible({
  id: 'openrouter',
  label: 'OpenRouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  defaultModel: 'deepseek/deepseek-v4.1-flash-1017',
  needsKey: true,
  hint: 'Get a key at openrouter.ai/keys. It is stored only on this device. Only models that can call tools are listed.',
  headers: { 'X-Title': 'Katana Studio' },
})

export const provider = openAiCompatible({
  id: 'openai',
  label: 'OpenAI-compatible server',
  defaultModel: 'local-model',
  needsKey: false,
  hint: 'LM Studio, Ollama, llama.cpp, vLLM, OpenAI... LM Studio needs CORS turned on in its server settings.',
})
