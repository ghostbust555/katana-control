// LLM providers AI Studio can use. To add one, implement LlmProvider (see types.ts) and list it here.
import { provider as anthropic } from './anthropic'
import { openrouter, provider as openai } from './openai'
import type { LlmProvider } from './types'

export * from './types'

export const providers: LlmProvider[] = [anthropic, openrouter, openai]
export const providerById = (id: string) => providers.find((p) => p.id === id) ?? anthropic
