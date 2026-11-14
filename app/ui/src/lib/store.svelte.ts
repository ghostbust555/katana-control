// App state: current tone + undo, tone library, guitars, channel assignments, amp connection.
import { backend, type Values } from './backend'
import { byId, channels, defaults, param, writable, type Value } from './schema'

export interface Tone {
  id: string
  schema: 1
  name: string
  author: string
  tags: string[]
  notes: string
  created: string
  modified: string
  device: { model: 'KATANA Gen3' }
  params: Values
}

export interface Guitar {
  id: string
  name: string
  pickups: 'single-coil' | 'humbucker' | 'p90' | 'other'
  deltas: Record<string, number>
}

export type View = 'editor' | 'library' | 'guitars'

interface Change {
  id: string
  from: Value
  to: Value
  at: number
}

export interface Toast {
  id: number
  text: string
  kind: 'info' | 'error'
}

export interface Ask {
  title: string
  value: string
  okLabel: string
  onsubmit: (value: string) => void
}

export interface Confirm {
  title: string
  body: string
  actions: { label: string; primary?: boolean; run: () => void }[]
}

const uid = () => crypto.randomUUID()
const now = () => new Date().toISOString()

export function newTone(name = 'New tone', values: Values = defaults()): Tone {
  const t = now()
  return {
    id: uid(), schema: 1, name, author: '', tags: [], notes: '', created: t, modified: t,
    device: { model: 'KATANA Gen3' }, params: { ...values },
  }
}

/** Patch name on the amp: 16 ASCII characters. */
const ampName = (s: string) => s.replace(/[^\x20-\x7d]/g, ' ').slice(0, 16).padEnd(16, ' ')

class Store {
  view = $state<View>('editor')
  block = $state('amp')

  tone = $state<Tone>(newTone())
  /** JSON of the params as last saved/loaded; differs from current when there are unsaved edits. */
  saved = $state('')
  /** Whether the current tone exists in the library (Save vs Save As). */
  inLibrary = $state(false)
  undoStack = $state<Change[]>([])
  redoStack = $state<Change[]>([])

  tones = $state<Tone[]>([])
  guitars = $state<Guitar[]>([])
  activeGuitarId = $state<string | null>(null)
  assignments = $state<Record<string, string | null>>(Object.fromEntries(channels.map((c) => [c.key, null])))

  amp = $state({ connected: false, port: '', busy: '' })
  toasts = $state<Toast[]>([])
  confirm = $state<Confirm | null>(null)
  ask = $state<Ask | null>(null)

  get dirty() {
    return JSON.stringify(this.tone.params) !== this.saved
  }
  get activeGuitar() {
    return this.guitars.find((g) => g.id === this.activeGuitarId) ?? null
  }

  async init() {
    backend.onAmpEvent((e) => {
      if (e.kind === 'param') this.setParam(e.id, e.value, { fromAmp: true })
      else {
        this.amp.connected = false
        this.toast(`Amp disconnected: ${e.reason}`, 'error')
      }
    })
    this.tones = ((await backend.listTones()) as Tone[]).sort((a, b) => b.modified.localeCompare(a.modified))
    const g = await backend.loadDoc<{ active: string | null; guitars: Guitar[] }>('guitars')
    if (g) {
      this.guitars = g.guitars
      this.activeGuitarId = g.active
    }
    const a = await backend.loadDoc<Record<string, string | null>>('channels')
    if (a) Object.assign(this.assignments, a)
    await backend.setDeltas(this.activeGuitar?.deltas ?? {})
    const last = await backend.loadDoc<{ toneId: string }>('session')
    const t = last && this.tones.find((t) => t.id === last.toneId)
    this.load(t ?? newTone(), !!t)
    this.connect(true)
  }

  toast(text: string, kind: Toast['kind'] = 'info') {
    const id = Date.now() + Math.random()
    this.toasts.push({ id, text, kind })
    setTimeout(() => (this.toasts = this.toasts.filter((t) => t.id !== id)), kind === 'error' ? 7000 : 3000)
  }

  async busy<T>(label: string, f: () => Promise<T>): Promise<T | undefined> {
    this.amp.busy = label
    try {
      return await f()
    } catch (e) {
      this.toast(String(e), 'error')
    } finally {
      this.amp.busy = ''
    }
  }

  // ---------------------------------------------------------------- editing

  setParam(id: string, value: Value, opts: { fromAmp?: boolean } = {}) {
    const from = this.tone.params[id]
    if (from === value) return
    this.tone.params[id] = value
    const last = this.undoStack.at(-1)
    const t = Date.now()
    // One undo step per gesture: merge rapid changes to the same param.
    if (last && last.id === id && t - last.at < 1000) {
      last.to = value
      last.at = t
    } else {
      this.undoStack.push({ id, from, to: value, at: t })
      if (this.undoStack.length > 500) this.undoStack.shift()
    }
    this.redoStack = []
    if (!opts.fromAmp) this.send({ [id]: value })
  }

  private send(values: Values) {
    if (this.amp.connected) backend.setParams(values).catch((e) => this.toast(String(e), 'error'))
  }

  undo() {
    const c = this.undoStack.pop()
    if (!c) return
    this.tone.params[c.id] = c.from
    this.redoStack.push(c)
    this.send({ [c.id]: c.from })
  }

  redo() {
    const c = this.redoStack.pop()
    if (!c) return
    this.tone.params[c.id] = c.to
    this.undoStack.push(c)
    this.send({ [c.id]: c.to })
  }

  /** Make `t` the editor tone. `fromLibrary`: it is a saved tone (Save overwrites it). */
  load(t: Tone, fromLibrary: boolean) {
    const copy: Tone = JSON.parse(JSON.stringify(t))
    copy.params = { ...defaults(), ...copy.params }
    this.tone = copy
    this.saved = JSON.stringify(copy.params)
    this.inLibrary = fromLibrary
    this.undoStack = []
    this.redoStack = []
    if (fromLibrary) backend.saveDoc('session', { toneId: t.id })
  }

  open(t: Tone) {
    const go = () => {
      this.load(t, true)
      this.view = 'editor'
      if (this.amp.connected) this.busy('Sending tone to amp…', () => backend.writePatch(this.tone.params))
    }
    if (this.dirty && t.id !== this.tone.id) this.askDiscard(go)
    else go()
  }

  newTone() {
    this.askDiscard(() => {
      this.load(newTone(), false)
      if (this.amp.connected) this.busy('Sending tone to amp…', () => backend.writePatch(this.tone.params))
    })
  }

  revert() {
    const t = this.tones.find((t) => t.id === this.tone.id)
    if (t) this.open(t)
    else this.load(newTone(), false)
    if (this.amp.connected) this.busy('Sending tone to amp…', () => backend.writePatch(this.tone.params))
  }

  private askDiscard(go: () => void) {
    if (!this.dirty) return go()
    this.confirm = {
      title: 'Unsaved changes',
      body: `"${this.tone.name}" has changes that aren't saved.`,
      actions: [
        { label: 'Cancel', run: () => {} },
        { label: 'Discard', run: go },
        { label: 'Save first', primary: true, run: () => this.save().then(go) },
      ],
    }
  }

  async save(asName?: string) {
    if (asName !== undefined) {
      this.tone.id = uid()
      this.tone.name = asName
      this.tone.created = now()
    }
    this.tone.modified = now()
    this.tone.params['com.name'] = ampName(this.tone.name)
    const snapshot: Tone = JSON.parse(JSON.stringify(this.tone))
    await backend.saveTone(snapshot)
    this.tones = [snapshot, ...this.tones.filter((t) => t.id !== snapshot.id)]
    this.saved = JSON.stringify(this.tone.params)
    this.inLibrary = true
    backend.saveDoc('session', { toneId: snapshot.id })
    this.toast(`Saved "${snapshot.name}"`)
  }

  rename(name: string) {
    this.tone.name = name
    this.setParam('com.name', ampName(name))
  }

  async duplicate(t: Tone) {
    const copy = { ...JSON.parse(JSON.stringify(t)), id: uid(), name: `${t.name} copy`, created: now(), modified: now() }
    await backend.saveTone(copy)
    this.tones = [copy, ...this.tones]
  }

  deleteTone(t: Tone) {
    this.confirm = {
      title: 'Delete tone',
      body: `Delete "${t.name}"? This can't be undone.`,
      actions: [
        { label: 'Cancel', run: () => {} },
        {
          label: 'Delete', primary: true,
          run: async () => {
            await backend.deleteTone(t.id)
            this.tones = this.tones.filter((x) => x.id !== t.id)
            for (const k in this.assignments) if (this.assignments[k] === t.id) this.assignments[k] = null
            backend.saveDoc('channels', this.assignments)
            if (this.tone.id === t.id) this.inLibrary = false
          },
        },
      ],
    }
  }

  async updateTone(t: Tone) {
    t.modified = now()
    await backend.saveTone($state.snapshot(t))
  }

  // ---------------------------------------------------------------- amp

  async connect(quiet = false) {
    try {
      this.amp.busy = 'Connecting…'
      this.amp.port = await backend.connect()
      this.amp.connected = true
    } catch (e) {
      if (!quiet) this.toast(String(e), 'error')
      return
    } finally {
      this.amp.busy = ''
    }
    await this.loadChannelsFromAmp()
    this.confirm = {
      title: 'Amp connected',
      body: 'Load the sound that is on the amp now into the editor, or send the editor tone to the amp?',
      actions: [
        { label: 'Leave both', run: () => {} },
        { label: 'Send editor tone', run: () => this.sendToAmp() },
        { label: 'Load from amp', primary: true, run: () => this.pullFromAmp() },
      ],
    }
  }

  /** Read A1/A2/B1/B2 from the amp and show them in the channel slots. A channel whose sound
   *  matches a library tone is linked to it; otherwise it is saved as a new tone tagged "from-amp". */
  async loadChannelsFromAmp() {
    for (const c of channels) {
      const ok = await this.busy(`Reading ${c.key} from the amp…`, async () => {
        const v = { ...defaults(), ...(await backend.readChannel(c.patch)) }
        const key = JSON.stringify(v)
        let t = this.tones.find((t) => JSON.stringify({ ...defaults(), ...t.params }) === key)
        if (!t) {
          const name = String(v['com.name'] ?? '').trim() || `${c.key} from amp`
          t = newTone(name, v)
          t.tags = ['from-amp']
          await backend.saveTone(t)
          this.tones = [t, ...this.tones]
        }
        this.assignments[c.key] = t.id
        return true
      })
      if (!ok) break // amp stopped answering; the error toast is already shown
    }
    backend.saveDoc('channels', this.assignments)
  }

  async disconnect() {
    await backend.disconnect()
    this.amp.connected = false
  }

  pullFromAmp() {
    return this.busy('Reading the amp…', async () => {
      const v = await backend.readPatch()
      const name = String(v['com.name'] ?? '').trim() || 'From amp'
      this.askDiscard(() => this.load(newTone(name, v), false))
    })
  }

  sendToAmp() {
    return this.busy('Sending tone to amp…', () => backend.writePatch(this.tone.params))
  }

  audition(t: Tone) {
    return this.busy(`Playing "${t.name}" on the amp…`, () => backend.writePatch({ ...defaults(), ...t.params }))
  }

  assign(channel: string, toneId: string | null) {
    this.assignments[channel] = toneId
    backend.saveDoc('channels', this.assignments)
  }

  async writeChannel(key: string) {
    const ch = channels.find((c) => c.key === key)!
    const t = this.tones.find((t) => t.id === this.assignments[key])
    if (!t) return this.toast(`No tone assigned to ${key}`, 'error')
    await this.busy(`Writing "${t.name}" to ${key}…`, async () => {
      await backend.writeChannel(ch.patch, { ...defaults(), ...t.params })
      this.toast(`${key} ← "${t.name}"`)
    })
  }

  async writeAllChannels() {
    for (const c of channels) if (this.assignments[c.key]) await this.writeChannel(c.key)
    // Leave the editor tone on the amp afterwards.
    if (this.amp.connected) await this.sendToAmp()
  }

  // ---------------------------------------------------------------- guitars

  private persistGuitars() {
    backend.saveDoc('guitars', { active: this.activeGuitarId, guitars: $state.snapshot(this.guitars) })
  }

  addGuitar(): Guitar {
    const g: Guitar = { id: uid(), name: 'New guitar', pickups: 'humbucker', deltas: {} }
    this.guitars.push(g)
    this.persistGuitars()
    return this.guitars.at(-1)!
  }

  updateGuitar() {
    this.persistGuitars()
    if (this.activeGuitar) this.applyDeltas(false)
  }

  deleteGuitar(g: Guitar) {
    this.confirm = {
      title: 'Delete guitar',
      body: `Delete "${g.name}" and its adjustments?`,
      actions: [
        { label: 'Cancel', run: () => {} },
        {
          label: 'Delete', primary: true,
          run: () => {
            this.guitars = this.guitars.filter((x) => x.id !== g.id)
            if (this.activeGuitarId === g.id) this.setActiveGuitar(null)
            this.persistGuitars()
          },
        },
      ],
    }
  }

  setActiveGuitar(id: string | null) {
    this.activeGuitarId = id
    this.persistGuitars()
    this.applyDeltas(true)
  }

  private deltaTimer = 0
  /** Push the active guitar's deltas to the backend and re-send the tone so the amp reflects them. */
  private applyDeltas(offerChannels: boolean) {
    clearTimeout(this.deltaTimer)
    this.deltaTimer = setTimeout(async () => {
      await backend.setDeltas($state.snapshot(this.activeGuitar?.deltas ?? {}))
      if (!this.amp.connected) return
      const ids = new Set(this.guitars.flatMap((g) => Object.keys(g.deltas)))
      const v: Values = {}
      for (const id of ids) if (byId.has(id)) v[id] = this.tone.params[id]
      await backend.setParams(v)
      if (offerChannels && Object.values(this.assignments).some(Boolean)) {
        this.confirm = {
          title: 'Update channels?',
          body: `The amp's channels were written for the previous guitar. Rewrite them for ${this.activeGuitar?.name ?? 'no guitar'}?`,
          actions: [
            { label: 'Not now', run: () => {} },
            { label: 'Rewrite channels', primary: true, run: () => this.writeAllChannels() },
          ],
        }
      }
    }, 250) as unknown as number
  }

  /** Value the amp gets for `id` with the active guitar's delta. */
  effective(id: string): Value {
    const v = this.tone.params[id]
    const d = this.activeGuitar?.deltas[id]
    if (typeof v !== 'number' || !d) return v
    const p = param(id)
    return Math.min(p.max, Math.max(p.min, v + d))
  }
}

export const store = new Store()
export { writable }
