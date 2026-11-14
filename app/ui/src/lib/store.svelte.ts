// App state: current tone + undo, tone library, guitars, channel assignments, amp connection.
import { backend, log, type Values } from './backend'
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

/** One song in a setlist: which tone goes on each amp channel. */
export interface Song {
  id: string
  name: string
  channels: Record<string, string | null>
}

export interface Setlist {
  id: string
  name: string
  songs: Song[]
}

export type View = 'editor' | 'library' | 'setlists' | 'guitars'

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

/** Stored patch numbers as the amp counts them. */
export const PATCH_NAMES = ['Panel', 'A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', 'B4']

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

  setlists = $state<Setlist[]>([])
  /** The song whose tones were last put on the amp's channels. */
  liveSong = $state<{ setlistId: string; songId: string } | null>(null)
  /** Guitar each channel was last written or read with (this session). With the tone in
   *  `assignments` it tells whether a channel already holds a sound, so it needn't be rewritten. */
  private channelGuitar: Record<string, string | null | undefined> = {}

  amp = $state({ connected: false, port: '', busy: '' })
  /** True while the editor tone is known to be what the amp is playing (edits flow both ways).
   *  Goes false when the amp switches channel or something else is put on the amp. */
  synced = $state(false)
  /** Stored patch the amp is on (0 = panel, 1-4 = A1-A4, 5-8 = B1-B4); null until known. */
  channel = $state<number | null>(null)
  /** Our own channel writes make the amp report a patch change; ignore those until this time. */
  private ignorePatchUntil = 0
  toasts = $state<Toast[]>([])
  confirm = $state<Confirm | null>(null)
  ask = $state<Ask | null>(null)

  get dirty() {
    return JSON.stringify(this.tone.params) !== this.saved
  }
  /** Name of the library tone on stored patch n, if known. */
  channelTone(n: number) {
    const key = channels.find((c) => c.patch === n)?.key
    return key ? (this.tones.find((t) => t.id === this.assignments[key])?.name ?? null) : null
  }

  get activeGuitar() {
    return this.guitars.find((g) => g.id === this.activeGuitarId) ?? null
  }

  async init() {
    log(`UI build ${__BUILD__}`)
    backend.onAmpEvent((e) => {
      if (e.kind === 'param') this.setParam(e.id, e.value, { fromAmp: true })
      else if (e.kind === 'patchSelected') {
        this.channel = e.number
        if (this.amp.busy || Date.now() < this.ignorePatchUntil) return
        this.synced = false
      } else {
        this.amp.connected = false
        this.synced = false
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
    const sl = await backend.loadDoc<{ setlists: Setlist[]; live: Store['liveSong'] }>('setlists')
    if (sl) {
      this.setlists = sl.setlists
      this.liveSong = sl.live
    }
    await backend.setDeltas(this.activeGuitar?.deltas ?? {})
    const last = await backend.loadDoc<{ toneId: string }>('session')
    const t = last && this.tones.find((t) => t.id === last.toneId)
    this.load(t ?? newTone(), !!t)
    this.connect()
  }

  toast(text: string, kind: Toast['kind'] = 'info') {
    if (kind === 'error') log(`error shown: ${text}`)
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
    if (this.amp.connected) {
      backend.setParams(values).catch((e) => {
        this.synced = false
        this.toast(String(e), 'error')
      })
    }
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
    this.synced = false
    this.undoStack = []
    this.redoStack = []
    if (fromLibrary) backend.saveDoc('session', { toneId: t.id })
  }

  open(t: Tone) {
    const go = () => {
      this.load(t, true)
      this.view = 'editor'
      if (this.amp.connected) this.sendToAmp()
    }
    if (this.dirty && t.id !== this.tone.id) this.askDiscard(go)
    else go()
  }

  newTone() {
    this.askDiscard(() => {
      this.load(newTone(), false)
      if (this.amp.connected) this.sendToAmp()
    })
  }

  revert() {
    const t = this.tones.find((t) => t.id === this.tone.id)
    if (t) return this.open(t) // open() sends it
    this.load(newTone(), false)
    if (this.amp.connected) this.sendToAmp()
  }

  private askDiscard(go: () => void) {
    if (!this.dirty) return go()
    this.confirm = {
      title: 'Unsaved changes',
      body: `"${this.tone.name}" has changes that aren't saved.`,
      actions: [
        { label: 'Cancel', run: () => {} },
        { label: 'Discard', run: go },
        { label: 'Save first', primary: true, run: () => this.save().then((ok) => ok && go()) },
      ],
    }
  }

  /** Save the editor tone. A name already used by another tone asks to overwrite that tone
   *  (which keeps its id, so channels and setlists that use it now get this sound). If the saved
   *  tone is on amp channels, they are rewritten right away. Resolves false if cancelled. */
  async save(asName?: string): Promise<boolean> {
    const name = asName ?? this.tone.name
    const key = name.trim().toLowerCase()
    const selfId = asName === undefined ? this.tone.id : null
    const clash = this.tones.find((t) => t.id !== selfId && t.name.trim().toLowerCase() === key)
    if (clash) {
      const ok = await new Promise<boolean>((done) => {
        this.confirm = {
          title: 'Overwrite tone?',
          body: `A tone called "${clash.name}" already exists. Replace it with this sound?` +
            (this.channelsOf(clash.id).length ? ` It is on ${this.channelsOf(clash.id).join(', ')}, which will be updated on the amp.` : ''),
          actions: [
            { label: 'Cancel', run: () => done(false) },
            { label: 'Overwrite', primary: true, run: () => done(true) },
          ],
        }
      })
      if (!ok) return false
      this.tone.id = clash.id
      this.tone.created = clash.created
      this.tone.tags = [...clash.tags]
    } else if (asName !== undefined) {
      this.tone.id = uid()
      this.tone.created = now()
    }
    this.tone.name = name
    this.tone.modified = now()
    this.tone.params['com.name'] = ampName(this.tone.name)
    const snapshot: Tone = JSON.parse(JSON.stringify(this.tone))
    await backend.saveTone(snapshot)
    this.tones = [snapshot, ...this.tones.filter((t) => t.id !== snapshot.id)]
    this.saved = JSON.stringify(this.tone.params)
    this.inLibrary = true
    backend.saveDoc('session', { toneId: snapshot.id })
    const on = this.channelsOf(snapshot.id)
    if (!on.length) this.toast(`Saved "${snapshot.name}"`)
    else if (!this.amp.connected) this.toast(`Saved "${snapshot.name}". Connect the amp to update ${on.join(', ')}.`)
    else await this.writeToChannels(snapshot, on)
    return true
  }

  /** Channels (A1...) whose assigned tone is `id`. */
  channelsOf(id: string) {
    return channels.filter((c) => this.assignments[c.key] === id).map((c) => c.key)
  }

  /** Rewrite `keys` with `t`, ending on the channel the amp is on so it keeps playing there. */
  private async writeToChannels(t: Tone, keys: string[]) {
    const cur = channels.find((c) => c.patch === this.channel)?.key
    const order = [...keys.filter((k) => k !== cur), ...keys.filter((k) => k === cur)]
    for (const k of order) if (!(await this.writeTone(k, t))) return
    this.toast(`Saved "${t.name}" and updated ${keys.join(', ')} on the amp`)
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
    // The editor is left as it is; Load from amp / Send to amp are explicit toolbar buttons.
    // It counts as synced only if the amp happens to be playing the same sound already.
    this.channel = await backend.currentPatch().catch(() => null)
    const cur = await this.busy('Reading the amp…', () => backend.readPatch())
    this.synced = !!cur && sameParams(cur, this.tone.params)
    await this.loadChannelsFromAmp()
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
        this.channelGuitar[c.key] = this.activeGuitarId
        return true
      })
      if (!ok) break // amp stopped answering; the error toast is already shown
    }
    backend.saveDoc('channels', this.assignments)
  }

  async disconnect() {
    await backend.disconnect()
    this.amp.connected = false
    this.channel = null
    this.synced = false
  }

  pullFromAmp() {
    return this.busy('Reading the amp…', async () => {
      const v = await backend.readPatch()
      const name = String(v['com.name'] ?? '').trim() || 'From amp'
      this.askDiscard(() => {
        this.load(newTone(name, v), false)
        this.synced = true
      })
    })
  }

  async sendToAmp() {
    const ok = await this.busy('Sending tone to amp…', async () => (await backend.writePatch(this.tone.params), true))
    if (ok) {
      this.synced = true
    }
  }

  async audition(t: Tone) {
    const v = { ...defaults(), ...t.params }
    const ok = await this.busy(`Playing "${t.name}" on the amp…`, async () => (await backend.writePatch(v), true))
    if (ok) this.synced = sameParams(v, this.tone.params)
  }

  assign(channel: string, toneId: string | null) {
    this.assignments[channel] = toneId
    backend.saveDoc('channels', this.assignments)
  }

  async writeChannel(key: string) {
    const t = this.tones.find((t) => t.id === this.assignments[key])
    if (!t) return this.toast(`No tone assigned to ${key}`, 'error')
    if (await this.writeTone(key, t)) this.toast(`${key} ← "${t.name}"`)
  }

  /** Store `t` (with the active guitar's adjustments) in channel `key`. */
  private async writeTone(key: string, t: Tone): Promise<boolean> {
    const ch = channels.find((c) => c.key === key)!
    // Writing a channel goes through the amp's current patch, so the amp ends up playing it.
    const v = { ...defaults(), ...t.params }
    const ok = await this.busy(`Writing "${t.name}" to ${key}…`, async () => (await backend.writeChannel(ch.patch, v), true))
    this.ignorePatchUntil = Date.now() + 1500
    this.synced = !!ok && sameParams(v, this.tone.params)
    if (ok) {
      this.channel = ch.patch // the amp switches to the channel it just stored
      this.channelGuitar[key] = this.activeGuitarId
      this.assignments[key] = t.id
      backend.saveDoc('channels', this.assignments)
    }
    return !!ok
  }

  /** Switch the amp to channel `key`, as its channel buttons do. If that channel's tone is
   *  known and the editor has nothing unsaved, the editor takes that tone and stays live. */
  async selectChannel(key: string) {
    const ch = channels.find((c) => c.key === key)!
    const ok = await this.busy(`Switching to ${key}…`, async () => (await backend.selectPatch(ch.patch), true))
    if (!ok) return
    this.ignorePatchUntil = Date.now() + 1500
    this.channel = ch.patch
    const t = this.tones.find((t) => t.id === this.assignments[key])
    if (t && this.channelGuitar[key] === this.activeGuitarId && !this.dirty) {
      this.load(t, true)
      this.synced = true
    } else {
      this.synced = false
    }
  }

  async writeAllChannels() {
    for (const c of channels) if (this.assignments[c.key]) await this.writeChannel(c.key)
    // Leave the editor tone on the amp afterwards.
    if (this.amp.connected) await this.sendToAmp()
  }

  // ---------------------------------------------------------------- setlists

  persistSetlists() {
    backend.saveDoc('setlists', { setlists: $state.snapshot(this.setlists), live: $state.snapshot(this.liveSong) })
  }

  addSetlist(): Setlist {
    this.setlists.push({ id: uid(), name: 'New setlist', songs: [] })
    this.persistSetlists()
    return this.setlists.at(-1)!
  }

  deleteSetlist(list: Setlist, then: () => void) {
    this.confirm = {
      title: 'Delete setlist',
      body: `Delete "${list.name}" and its ${list.songs.length} song${list.songs.length === 1 ? '' : 's'}? The tones are kept.`,
      actions: [
        { label: 'Cancel', run: () => {} },
        {
          label: 'Delete', primary: true,
          run: () => {
            this.setlists = this.setlists.filter((x) => x.id !== list.id)
            if (this.liveSong?.setlistId === list.id) this.liveSong = null
            this.persistSetlists()
            then()
          },
        },
      ],
    }
  }

  /** New song; starts with the previous song's channels (or the amp's), since tones often repeat. */
  addSong(list: Setlist) {
    const prev = list.songs.at(-1)?.channels ?? this.assignments
    list.songs.push({ id: uid(), name: `Song ${list.songs.length + 1}`, channels: { ...prev } })
    this.persistSetlists()
  }

  /** Put a song's tones on the amp's channels, then switch the amp to its first channel.
   *  Channels that already hold the right tone (for the active guitar) are not rewritten. */
  async applySong(list: Setlist, song: Song) {
    if (!this.amp.connected) return this.toast('Connect the amp first', 'error')
    if (this.amp.busy) return
    let missing = 0
    for (const c of channels) {
      const id = song.channels[c.key]
      if (!id) continue
      const t = this.tones.find((t) => t.id === id)
      if (!t) { missing++; continue }
      if (this.assignments[c.key] === id && this.channelGuitar[c.key] === this.activeGuitarId) continue
      if (!(await this.writeTone(c.key, t))) return // error toast already shown
    }
    this.liveSong = { setlistId: list.id, songId: song.id }
    this.persistSetlists()
    const first = channels.find((c) => song.channels[c.key] && this.tones.some((t) => t.id === song.channels[c.key]))
    if (first) await this.selectChannel(first.key)
    if (missing) this.toast(`${missing} tone${missing === 1 ? ' was' : 's were'} deleted from the library; left as is`, 'error')
    else this.toast(`"${song.name}" is on the amp${first ? ` · ${first.key}` : ''}`)
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

/** Same sound: equal on every writable param (names compared without trailing padding). */
function sameParams(a: Values, b: Values) {
  const norm = (v: Value | undefined) => (typeof v === 'string' ? v.trimEnd() : v)
  return writable.every((p) => norm(a[p.id]) === norm(b[p.id]))
}
