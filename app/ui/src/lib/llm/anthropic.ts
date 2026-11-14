// Claude through the Anthropic SDK, called straight from the app (the key stays on this device).
import Anthropic from '@anthropic-ai/sdk'
import { LlmError, type ChatSession, type LlmProvider, type LlmSettings, type StepResult, type ToolDef, type ToolResult } from './types'

class AnthropicSession implements ChatSession {
  private history: Anthropic.Beta.BetaMessageParam[] = []
  private client: Anthropic
  private tools: Anthropic.Beta.BetaTool[]

  constructor(private settings: LlmSettings, private system: string, tools: ToolDef[]) {
    this.client = new Anthropic({ apiKey: settings.apiKey, dangerouslyAllowBrowser: true })
    this.tools = tools.map((t) => ({
      name: t.name, description: t.description, eager_input_streaming: true,
      input_schema: t.schema as Anthropic.Beta.BetaTool.InputSchema,
    }))
  }

  addUser(parts: string[]) {
    this.history.push({ role: 'user', content: parts.map((text) => ({ type: 'text' as const, text })) })
  }

  addToolResults(results: ToolResult[]) {
    this.history.push({
      role: 'user',
      content: results.map((r) => ({ type: 'tool_result' as const, tool_use_id: r.id, content: r.content, ...(r.isError ? { is_error: true } : {}) })),
    })
  }

  mark() { return this.history.length }
  rollback(mark: number) { this.history.length = mark }

  async step({ onText, signal }: { onText: (d: string) => void; signal: AbortSignal }): Promise<StepResult> {
    for (let jsonRetries = 0; ; ) {
      const stream = this.client.beta.messages.stream({
        model: this.settings.model || provider.defaultModel,
        max_tokens: 16000,
        output_config: { effort: 'medium' },
        system: [{ type: 'text', text: this.system, cache_control: { type: 'ephemeral' } }],
        cache_control: { type: 'ephemeral' },
        tools: this.tools,
        messages: this.history,
        // On a policy decline the API retries on a suitable fallback model inside the same call.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      }, { signal })
      stream.on('text', onText)
      let msg: Anthropic.Beta.BetaMessage
      try {
        msg = await stream.finalMessage()
      } catch (e) {
        // With eager input streaming a tool input can fail to parse; re-issue that call (capped).
        // API errors, including aborts, are not retried.
        if (e instanceof Anthropic.APIError || jsonRetries++ >= 2) throw toLlmError(e)
        continue
      }
      if (msg.stop_reason === 'refusal') return { text: '', calls: [], stop: 'refused' }
      this.history.push({ role: 'assistant', content: msg.content })
      const text = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
      if (msg.stop_reason === 'pause_turn') return { text, calls: [], stop: 'tools' }
      const calls = msg.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, input: b.input }))
      if (calls.length && msg.stop_reason === 'max_tokens') {
        this.history.pop() // the tool input may be cut off: don't keep or run it
        return { text, calls: [], stop: 'truncated' }
      }
      return { text, calls, stop: calls.length ? 'tools' : 'done' }
    }
  }
}

function toLlmError(e: unknown): LlmError {
  if (e instanceof Anthropic.APIUserAbortError) return new LlmError('aborted', 'Stopped.')
  if (e instanceof Anthropic.AuthenticationError) return new LlmError('auth', 'The Anthropic API key was rejected.')
  if (e instanceof Anthropic.PermissionDeniedError) return new LlmError('auth', "This API key isn't allowed to use the model.")
  if (e instanceof Anthropic.RateLimitError) return new LlmError('rate', 'Rate limited by the API; wait a moment and try again.')
  if (e instanceof Anthropic.APIConnectionError) return new LlmError('network', "Couldn't reach api.anthropic.com.")
  if (e instanceof Anthropic.APIError) return new LlmError('other', `API error ${e.status ?? ''}: ${e.message}`)
  return new LlmError('other', e instanceof Error ? e.message : String(e))
}

export const provider: LlmProvider = {
  id: 'anthropic',
  label: 'Claude (Anthropic API)',
  defaultModel: 'claude-opus-5-5',
  needsKey: true,
  needsBaseUrl: false,
  hint: 'Get a key at console.anthropic.com. It is stored only on this device and sent only to the API.',
  newSession: (s, system, tools) => new AnthropicSession(s, system, tools),
  async listModels(s) {
    const client = new Anthropic({ apiKey: s.apiKey, dangerouslyAllowBrowser: true })
    const out = []
    try {
      for await (const m of client.models.list()) out.push({ id: m.id, name: m.display_name })
    } catch (e) {
      throw toLlmError(e)
    }
    return out
  },
}
