// AI Studio: describe a tone in words and Claude builds it on the amp. Each request runs a
// short tool loop: Claude can list and read the tones on this device (your tones and the
// defaults), and sets the editor tone with set_tone, which goes to the amp right away. You play,
// then ask for changes; every reply that changed the tone keeps a snapshot you can go back to.
import { backend, type Values } from './backend'
import { LlmError, providerById, type ChatSession, type LlmSettings, type ToolDef } from './llm'
import { presets } from './presets'
import { byId, defaults, format, layout, visibleGroups, type Param, type Value } from './schema'
import { store, type Tone } from './store.svelte'

const MAX_STEPS = 8

export interface ChatEntry {
  id: number
  role: 'user' | 'assistant'
  text: string
  /** Params after this reply's changes, when it changed the tone. */
  snapshot?: Values
  /** Short list of what changed, e.g. "Gain 45 → 60". */
  changes?: string[]
  error?: boolean
  pending?: boolean
}

// ------------------------------------------------------------------ describing tones

/** Blocks Claude may edit (the rest is foot switch / pedal assignment plumbing). */
const BLOCKS = layout.filter((b) => !['sendreturn', 'patch', 'contour'].includes(b.key))
const optionName = (p: Param, v: Value) => (p.options ? (p.options[Number(v) - p.min] ?? String(v)) : String(v))

/** The tone as Claude reads it: per block, on/off, colour and the params that are in use. */
export function describe(values: Values, name?: string): string {
  const out: string[] = []
  if (name) out.push(`Name: ${name}`)
  for (const b of BLOCKS) {
    const on = b.switch ? Number(values[b.switch]) === 1 : true
    const color = b.color ? ` ${optionName(byId.get(b.color)!, values[b.color])}` : ''
    const head = `${b.label}${b.switch ? (on ? ' [ON' : ' [off') + color + ']' : ''}`
    const ids = visibleGroups(b, values).flatMap((g) => g.params).filter((id) => id !== b.switch && id !== b.color)
    if (!on) {
      const type = ids.find((id) => id.endsWith('.type'))
      out.push(`${head}${type ? ` ${type}=${optionName(byId.get(type)!, values[type])}` : ''}`)
      continue
    }
    out.push(`${head}: ` + ids.map((id) => `${id}=${optionName(byId.get(id)!, values[id])}`).join(', '))
  }
  return out.join('\n')
}

/** Parameter reference for the system prompt, generated from the schema. */
function reference(): string {
  const out: string[] = []
  for (const b of BLOCKS) {
    out.push(`\n## ${b.label}` + (b.switch ? ` (on/off: ${b.switch})` : '') + (b.color ? ` (colour: ${b.color})` : ''))
    if (b.key === 'fx') { out.push('Same types and params as Mod, with fx1 -> fx4 and fx_detail1 -> fx_detail4.'); continue }
    for (const g of b.variations[0].groups) {
      const when = g.when ? ` (when ${g.when.param}=${optionName(byId.get(g.when.param)!, g.when.equals)})` : ''
      if (b.variations[0].groups.length > 1) out.push(`### ${g.label}${when}`)
      for (const id of g.params) {
        const p = byId.get(id)!
        if (id === b.switch) continue
        const range = p.enc === 'ascii' ? `text, ${p.len} chars` : p.options ? p.options.join(' | ') : p.switch ? '0/1' : `${p.min}..${p.max}${p.unit ? ' ' + p.unit : ''}`
        out.push(`${id} "${p.label}": ${range}; default ${optionName(p, p.init)}`)
      }
    }
  }
  return out.join('\n')
}

const SYSTEM = `You are the tone designer inside Katana Studio, an editor for the BOSS Katana Gen 3 guitar amp. The player describes a sound; you build it on the amp with the set_tone tool, they play it, then ask for changes. Keep going until they are happy; they save it themselves.

How to work:
- When the request needs a different sound, call set_tone in this turn. Don't ask first: make your best attempt, they will hear it right away. Ask a question only if the request is truly ambiguous, and still apply a best guess.
- The player may name a song, an artist, a genre, a piece of gear, or one of their saved tones ("like my Crunch tone but darker"). Use list_tones / get_tone to find tones they refer to; the default tones that ship with the app are there too.
- Base new tones on what real players use for that sound: amp character and gain staging, boost or pedal in front, EQ, time effects. A good tone is usually simple: say 1-3 blocks on besides the amp, sensible levels, no clipping volume jumps.
- For changes ("more bite", "less fizz", "the delay is too loud") keep everything else as it is and adjust only what is needed. Small, audible steps.
- Keep volume roughly where it was unless asked; very high gain needs the noise suppressor.
- After applying, reply in 1-3 short sentences: what you set and what to listen for or try next (pickup, playing tip). The player is holding a guitar and reading on a tablet: no lists of parameters, no markdown headings.

Amp and blocks:
- Amp types (amp.type): Acoustic, Clean (Roland JC style), Pushed (tweed/AC30-ish edge of breakup), Crunch (Plexi-style), Lead (hot-rodded Marshall), Brown (high gain, EVH/modern metal). preamp_variation "Variation" gives each a different voicing.
- Booster, Mod, FX, Delay, Reverb have three colour slots (Green/Red/Yellow) chosen by their colour param; each slot is its own set of params: booster1/2/3, Mod fx1/2/3 with fx_detail1/2/3, FX fx4/5/6 with fx_detail4/5/6, Delay delay1/2/3, Reverb reverb1/2/3, Delay 2 delay4/5/6 (Delay 2 follows the reverb colour). Use Green (slot 1, or 4 for FX and Delay 2) unless the current tone already uses another colour for that block; then edit the slot its colour selects.
- Mod and FX are each one effect: set fx1.type (or fx4.type) and then that type's params in fx_detail1.<type>.* (or fx_detail4.<type>.*).
- Turning a block on: set its switch to 1 (e.g. sw.delay_sw). Off blocks keep their settings.
- Values: numbers in the units shown, option params by option name exactly as listed, switches 0/1. Delay time is in ms.

Parameter reference (only these params can be set):
${reference()}`

// ------------------------------------------------------------------ tools

const tools: ToolDef[] = [
  {
    name: 'set_tone',
    description: 'Apply a tone to the editor and the amp right away. Changes are applied on top of a starting point: the current editor tone (default), the plain amp defaults ("blank"), or a tone from list_tones (its id). Returns the resulting tone and any rejected values.',
    schema: {
      type: 'object',
      properties: {
        start_from: { type: 'string', description: '"current" (default), "blank", or a tone id from list_tones' },
        changes: {
          type: 'object',
          description: 'Param id -> value. Numbers for numeric params, option names for option params, 0/1 for switches.',
          additionalProperties: { type: ['number', 'string'] },
        },
        name: { type: 'string', description: 'Short tone name (shown on the amp, 16 characters). Set it for a new sound; omit for small tweaks.' },
      },
      required: ['changes'],
    },
  },
  {
    name: 'list_tones',
    description: "List the tones on this device: the player's saved tones and the default tones that ship with the app (id, name, tags, amp type, blocks on, notes).",
    schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_tone',
    description: 'Read the full settings of a tone from list_tones.',
    schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
]

function listTones(): string {
  const line = (t: Tone, kind: string) => {
    const v = { ...defaults(), ...t.params }
    const on = BLOCKS.filter((b) => b.switch && b.key !== 'amp' && Number(v[b.switch]) === 1).map((b) => b.label)
    const notes = t.notes ? ` - ${t.notes.slice(0, 140)}` : ''
    return `${t.id} | ${kind} | ${t.name} | ${optionName(byId.get('amp.type')!, v['amp.type'])}${on.length ? ' + ' + on.join(', ') : ''}${t.tags.length ? ' | #' + t.tags.join(' #') : ''}${notes}`
  }
  return ['id | kind | name | amp + blocks on | tags - notes', ...store.tones.map((t) => line(t, 'saved')), ...presets.map((t) => line(t, 'default'))].join('\n')
}

/** Parse one value the model sent for `p`, or say why it doesn't fit. */
function parseValue(p: Param, raw: unknown): { ok: Value } | { err: string } {
  let v: number
  if (typeof raw === 'number') v = raw
  else if (typeof raw === 'string') {
    const t = raw.trim()
    const i = p.options?.findIndex((o) => o.toLowerCase() === t.toLowerCase()) ?? -1
    if (i >= 0) return { ok: p.min + i }
    if (p.switch && /^(on|true)$/i.test(t)) return { ok: 1 }
    if (p.switch && /^(off|false)$/i.test(t)) return { ok: 0 }
    v = Number(t.replace(/\s*(ms|db|hz|%)$/i, ''))
    if (Number.isNaN(v) || p.options) return { err: `${p.id}: "${raw}" is not one of ${p.options ? p.options.join(' | ') : 'the allowed values'}` }
  } else return { err: `${p.id}: unsupported value ${JSON.stringify(raw)}` }
  v = Math.round(v)
  if (v < p.min || v > p.max) return { err: `${p.id}: ${v} is outside ${p.min}..${p.max}` }
  return { ok: v }
}

const ALLOWED = new Set<string>(BLOCKS.flatMap((b) => [b.switch, b.color, ...b.variations.flatMap((x) => x.groups.flatMap((g) => g.params))]).filter((x): x is string => !!x))
const fail = (msg: string) => ({ content: msg, is_error: true })

function runTool(name: string, input: unknown): { content: string; is_error?: boolean; applied?: string[] } {
  const args = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  if (name === 'list_tones') return { content: listTones() }
  if (name === 'get_tone') {
    if (typeof args.id !== 'string') return fail('INVALID_JSON: id must be a string')
    const t = store.findTone(args.id)
    return t ? { content: describe({ ...defaults(), ...t.params }, t.name) + (t.notes ? `\nNotes: ${t.notes}` : '') } : fail(`No tone with id ${args.id}; call list_tones`)
  }
  if (name !== 'set_tone') return fail(`Unknown tool ${name}`)
  const changes = args.changes
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return fail(`INVALID_JSON: ${JSON.stringify(input)}`)
  const start = typeof args.start_from === 'string' ? args.start_from : 'current'
  let base: Values
  if (start === 'current') base = { ...store.tone.params }
  else if (start === 'blank') base = defaults()
  else {
    const t = store.findTone(start)
    if (!t) return fail(`No tone with id ${start}; call list_tones`)
    base = { ...defaults(), ...t.params }
  }
  const next = { ...base }
  const errors: string[] = []
  for (const [id, raw] of Object.entries(changes as Record<string, unknown>)) {
    const p = byId.get(id)
    if (!p || !ALLOWED.has(id) || p.enc === 'ascii') { errors.push(`${id}: unknown or not settable${p?.enc === 'ascii' ? ' (use the name field)' : ''}`); continue }
    const v = parseValue(p, raw)
    if ('err' in v) errors.push(v.err)
    else next[id] = v.ok
  }
  const before = { ...store.tone.params }
  store.applyParams(next, typeof args.name === 'string' && args.name.trim() ? args.name.trim() : undefined)
  // If the amp is playing something else, put the whole tone on it so what you hear is what was built.
  if (store.amp.connected && !store.synced) store.sendToAmp()
  const applied = Object.keys(next).filter((id) => next[id] !== before[id] && byId.get(id)?.enc !== 'ascii')
    .map((id) => changeText(id, before[id], next[id]))
  const amp = store.amp.connected ? 'Sent to the amp.' : 'The amp is not connected, so it is only in the editor for now.'
  return {
    content: `${errors.length ? 'Some values were rejected (everything else was applied):\n' + errors.join('\n') + '\n\n' : ''}${amp}\nTone now:\n${describe(store.tone.params, store.tone.name)}`,
    applied,
  }
}

/** "Amp Gain 45 → 60", "Reverb on", "Delay colour Green → Red". */
function changeText(id: string, from: Value, to: Value) {
  const p = byId.get(id)!
  const b = BLOCKS.find((b) => b.switch === id || b.color === id || b.variations.some((v) => v.groups.some((g) => g.params.includes(id))))
  const block = b?.label ?? ''
  if (b && id === b.switch) return `${block} ${to ? 'on' : 'off'}`
  const label = id === b?.color ? 'colour' : p.label
  const name = label.toLowerCase().startsWith(block.toLowerCase()) ? label : `${block} ${label.toLowerCase()}`
  return `${name.trim()} ${format(p, from)} → ${format(p, to)}`
}

// ------------------------------------------------------------------ conversation

type ProviderSettings = Omit<LlmSettings, 'provider'>
/** Saved as the "ai" doc: the chosen provider, and key/model/URL for each provider used. */
interface Stored { provider: string; byProvider: Record<string, ProviderSettings> }
const EMPTY: ProviderSettings = { apiKey: '', model: '', baseUrl: '' }

class AiStudio {
  entries = $state<ChatEntry[]>([])
  busy = $state(false)
  status = $state('')
  private stored = $state<Stored>({ provider: 'openrouter', byProvider: {} })
  loaded = $state(false)
  private session: ChatSession | null = null
  private abort: AbortController | null = null
  private nextId = 1

  /** Settings of the chosen provider. */
  get settings(): LlmSettings { return this.settingsFor(this.stored.provider) }
  settingsFor(id: string): LlmSettings { return { provider: id, ...EMPTY, ...this.stored.byProvider[id] } }
  get provider() { return providerById(this.stored.provider) }
  /** Whether enough is set up to send a request. */
  get ready() { return (!this.provider.needsKey || !!this.settings.apiKey) && (!this.provider.needsBaseUrl || !!this.settings.baseUrl) }

  async init() {
    if (this.loaded) return
    const doc = await backend.loadDoc<Partial<Stored> & Partial<LlmSettings>>('ai')
    if (doc?.byProvider) this.stored = { provider: doc.provider ?? 'openrouter', byProvider: doc.byProvider }
    else if (doc?.provider) { // first version stored one flat settings object
      const { provider, apiKey = '', model = '', baseUrl = '' } = doc
      this.stored = { provider, byProvider: { [provider]: { apiKey, model, baseUrl } } }
    }
    this.loaded = true
  }

  async saveSettings(s: LlmSettings) {
    this.stored.provider = s.provider
    this.stored.byProvider[s.provider] = { apiKey: s.apiKey.trim(), model: s.model.trim(), baseUrl: s.baseUrl.trim() }
    await backend.saveDoc('ai', $state.snapshot(this.stored))
    this.session = null // the next request starts a conversation with the new settings
  }

  newChat() {
    this.stop()
    this.entries = []
    this.session = null
  }

  stop() { this.abort?.abort() }

  /** Put the tone back the way a reply left it. */
  restore(e: ChatEntry) {
    if (!e.snapshot) return
    store.applyParams(e.snapshot)
    if (store.amp.connected && !store.synced) store.sendToAmp()
  }

  async send(text: string) {
    text = text.trim()
    if (!text || this.busy || !this.ready) return
    this.entries.push({ id: this.nextId++, role: 'user', text })
    this.entries.push({ id: this.nextId++, role: 'assistant', text: '', pending: true, changes: [] })
    const r = this.entries.at(-1)!
    this.busy = true
    this.status = 'Thinking…'
    this.session ??= this.provider.newSession(this.settings, SYSTEM, tools)
    const session = this.session
    const turnStart = session.mark()
    const guitar = store.activeGuitar
    session.addUser([
      text,
      `[Editor tone right now (the player may have changed it by hand). Amp ${store.amp.connected ? 'connected' : 'not connected'}. Guitar: ${guitar ? `${guitar.name}, ${guitar.pickups} pickups` : 'not specified'}.]\n${describe(store.tone.params, store.tone.name)}`,
    ])
    this.abort = new AbortController()
    try {
      for (let step = 0; ; step++) {
        if (step >= MAX_STEPS) throw new LlmError('other', 'Gave up after too many steps; try rephrasing.')
        if (r.text && !r.text.endsWith('\n')) r.text += '\n\n'
        const res = await session.step({ onText: (d) => { r.text += d; this.status = '' }, signal: this.abort.signal })
        if (res.stop === 'refused') { r.text ||= "I can't help with that one."; break }
        if (res.stop === 'truncated') throw new LlmError('other', 'The reply was cut off; try a shorter request.')
        if (res.stop === 'done') break
        session.addToolResults(res.calls.map((c) => {
          this.status = c.name === 'set_tone' ? 'Setting the tone…' : 'Looking at your tones…'
          const out = runTool(c.name, c.input)
          if (out.applied) {
            for (const x of out.applied) if (!r.changes!.includes(x)) r.changes!.push(x)
            r.snapshot = { ...store.tone.params }
          }
          return { id: c.id, content: out.content, isError: out.is_error }
        }))
        this.status = 'Thinking…'
      }
    } catch (e) {
      // Drop the unfinished turn so the next request starts clean; the tone stays as applied.
      session.rollback(turnStart)
      r.error = true
      r.text = r.text.trimEnd() + (r.text.trim() ? '\n\n' : '') + (e instanceof Error ? e.message : String(e))
    } finally {
      r.pending = false
      this.busy = false
      this.status = ''
      this.abort = null
    }
  }
}

export const ai = new AiStudio()
