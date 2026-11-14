// Provider-neutral chat-with-tools interface. AI Studio talks only to this; each provider keeps
// the conversation in its own wire format (so provider-specific blocks such as Claude's
// thinking are passed back unchanged) and turns its replies into text + tool calls.

export interface ToolDef {
  name: string
  description: string
  /** JSON Schema of the tool's input object. */
  schema: Record<string, unknown>
}

export interface ToolCall {
  id: string
  name: string
  /** Parsed input. Untrusted: validate before use. */
  input: unknown
}

export interface ToolResult {
  id: string
  content: string
  isError?: boolean
}

export interface StepResult {
  text: string
  calls: ToolCall[]
  /** done: a final answer; tools: run `calls` and continue; refused / truncated: stop. */
  stop: 'done' | 'tools' | 'refused' | 'truncated'
}

export interface ChatSession {
  addUser(parts: string[]): void
  addToolResults(results: ToolResult[]): void
  /** One model call on the conversation so far. Streams text through onText. */
  step(opts: { onText: (delta: string) => void; signal: AbortSignal }): Promise<StepResult>
  /** History position, to drop an unfinished turn with rollback(). */
  mark(): number
  rollback(mark: number): void
}

export interface LlmSettings {
  provider: string
  apiKey: string
  /** Model id; empty uses the provider's default. */
  model: string
  /** For OpenAI-compatible servers (LM Studio, Ollama, OpenRouter, ...). */
  baseUrl: string
}

export interface ModelInfo {
  id: string
  name: string
  /** Price, context size, ... */
  detail?: string
}

export interface LlmProvider {
  id: string
  label: string
  defaultModel: string
  needsKey: boolean
  needsBaseUrl: boolean
  /** Shown under the settings, e.g. where to get a key. */
  hint?: string
  newSession(settings: LlmSettings, system: string, tools: ToolDef[]): ChatSession
  /** Models to pick from (only ones that can call tools, where the provider says). */
  listModels?(settings: LlmSettings): Promise<ModelInfo[]>
}

export type LlmErrorKind = 'auth' | 'rate' | 'network' | 'aborted' | 'other'

export class LlmError extends Error {
  constructor(public kind: LlmErrorKind, message: string) {
    super(message)
  }
}
