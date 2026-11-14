// Any server speaking the OpenAI chat/completions API with tool calls: LM Studio, Ollama,
// llama.cpp server, vLLM, OpenRouter, OpenAI itself. Plain fetch + server-sent events.
import { LlmError, type ChatSession, type LlmProvider, type LlmSettings, type StepResult, type ToolDef, type ToolResult } from './types'

type Msg =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[] }
  | { role: 'tool'; tool_call_id: string; content: string }

class OpenAiSession implements ChatSession {
  private history: Msg[]
  private tools: unknown[]

  constructor(private s: LlmSettings, system: string, tools: ToolDef[]) {
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
    const base = (this.s.baseUrl || 'http://localhost:1234/v1').replace(/\/+$/, '')
    let res: Response
    try {
      res = await fetch(`${base}/chat/completions`, {
        method: 'POST', signal,
        headers: { 'content-type': 'application/json', ...(this.s.apiKey ? { authorization: `Bearer ${this.s.apiKey}` } : {}) },
        body: JSON.stringify({ model: this.s.model || provider.defaultModel, messages: this.history, tools: this.tools, stream: true }),
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

export const provider: LlmProvider = {
  id: 'openai',
  label: 'OpenAI-compatible server',
  defaultModel: 'local-model',
  needsKey: false,
  needsBaseUrl: true,
  newSession: (s, system, tools) => new OpenAiSession(s, system, tools),
}
