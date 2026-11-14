// Groups a block's params into a few labelled, colour-coded sections (type, drive, tone,
// time, level, switches) so related controls sit together and are easy to spot. Purely
// by label, so every block and effect type gets it without per-effect layout work.
import { isNumeric, param, type Param } from './schema'

export type Cat = 'setup' | 'drive' | 'eq' | 'time' | 'level' | 'switch'

export const CATS: Record<Cat, { label: string; color: string }> = {
  setup: { label: 'Type & mode', color: '#8aa4c8' },
  drive: { label: 'Drive & dynamics', color: '#e8743d' },
  eq: { label: 'Tone', color: '#3fbfae' },
  time: { label: 'Time & motion', color: '#a98be8' },
  level: { label: 'Level', color: '#7fcf5a' },
  switch: { label: 'Switches', color: '#9a9ea8' },
}
const ORDER: Cat[] = ['setup', 'drive', 'eq', 'time', 'level', 'switch']

export function category(p: Param): Cat {
  const l = p.label.toLowerCase()
  if (p.switch) return 'switch'
  if (p.enc === 'ascii') return 'setup'
  if (/level|volume|\bmix\b/.test(l) && !/^(low|high|mid)/.test(l)) return 'level'
  if (/bass|middle|treble|presence|tone|bottom|low|mid|high|hz|freq|\bq\b|cut|filter|resonance|peak|color/.test(l)) return 'eq'
  if (/gain|drive|sens|sustain|threshold|ratio|attack|release/.test(l)) return 'drive'
  if (/time|feedback|rate|depth|delay|density|tap|pedal|speed|pitch|shift|phase/.test(l)) return 'time'
  return 'setup'
}

/** One tile: a param, optionally with the on/off switch it belongs to (`x_sw` + `x_…`). */
export interface Tile { id: string; sw?: string }

export function tiles(ids: string[]): Tile[] {
  const out: Tile[] = []
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]
    const next = ids[i + 1]
    const stem = id.endsWith('_sw') ? id.slice(0, -2) : null
    if (stem && next?.startsWith(stem) && param(id).switch && isNumeric(param(next))) {
      out.push({ id: next, sw: id })
      i++
    } else out.push({ id })
  }
  return out
}

export function sections(ids: string[]): { cat: Cat; tiles: Tile[] }[] {
  const by = new Map<Cat, Tile[]>()
  for (const t of tiles(ids)) {
    const c = category(param(t.id))
    if (!by.has(c)) by.set(c, [])
    by.get(c)!.push(t)
  }
  return ORDER.filter((c) => by.has(c)).map((cat) => ({ cat, tiles: by.get(cat)! }))
}
