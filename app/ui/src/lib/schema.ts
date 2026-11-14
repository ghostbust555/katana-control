// Parameter schema shared with the Rust core.
import raw from '$schema'

export type Value = number | string

export interface Param {
  id: string
  block: string
  name: string
  addr: string
  enc: 'u7' | 'n2' | 'n4' | 'u14' | 'ascii'
  len: number
  min: number
  max: number
  ofs: number
  init: Value
  label: string
  options?: string[]
  switch?: boolean
  readonly?: boolean
  unit?: string
  fx_type?: number
}

export interface Group {
  label: string
  params: string[]
  when?: { param: string; equals: number }
}

export interface Block {
  key: string
  label: string
  switch?: string
  color?: string
  variations: { groups: Group[] }[]
}

export interface Channel {
  key: string
  patch: number
}

const s = raw as unknown as { params: Param[]; layout: Block[]; channels: Channel[] }

export const params: Param[] = s.params
export const layout: Block[] = s.layout
export const allChannels: Channel[] = s.channels
/** The channels this amp's panel has (KATANA Gen 3: A/B banks, channels 1 and 2 in use). */
export const channels: Channel[] = s.channels.filter((c) => ['A1', 'A2', 'B1', 'B2'].includes(c.key))

export const byId = new Map(params.map((p) => [p.id, p]))
export const param = (id: string): Param => {
  const p = byId.get(id)
  if (!p) throw new Error(`unknown param ${id}`)
  return p
}

export const writable = params.filter((p) => !p.readonly)

export function defaults(): Record<string, Value> {
  return Object.fromEntries(writable.map((p) => [p.id, p.init]))
}

export const isNumeric = (p: Param) => p.enc !== 'ascii' && !p.options && !p.switch

export function format(p: Param, v: Value | undefined): string {
  if (v === undefined) return '–'
  if (typeof v === 'string') return v.trimEnd()
  if (p.options) return p.options[v - p.min] ?? String(v)
  if (p.switch) return v ? 'On' : 'Off'
  const sign = p.min < 0 && v > 0 ? '+' : ''
  return `${sign}${v}${p.unit ? ' ' + p.unit : ''}`
}

/** Which variation (0..2) a block is showing, from its colour param. */
export function variationIndex(b: Block, values: Record<string, Value>): number {
  return b.color ? Number(values[b.color] ?? 0) : 0
}

/** Groups to show for a block given the current values (type-dependent groups filtered). */
export function visibleGroups(b: Block, values: Record<string, Value>): Group[] {
  const v = b.variations[Math.min(variationIndex(b, values), b.variations.length - 1)]
  return v.groups.filter((g) => !g.when || Number(values[g.when.param]) === g.when.equals)
}

export const COLOR_CSS = ['#3fbf5f', '#e0483e', '#e8c33d']
