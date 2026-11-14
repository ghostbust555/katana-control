// Talks to the Rust backend inside Tauri. Outside Tauri (plain browser, for UI development and
// screenshots) a mock backend stores data in localStorage and pretends an amp is attached.
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { defaults, type Value } from './schema'

export type Values = Record<string, Value>
export type AmpEvent =
  | { kind: 'param'; id: string; value: Value }
  | { kind: 'patchSelected'; number: number }
  | { kind: 'disconnected'; reason: string }

export interface Backend {
  listPorts(): Promise<string[]>
  connect(port?: string): Promise<string>
  disconnect(): Promise<void>
  setParams(values: Values): Promise<void>
  readPatch(): Promise<Values>
  readChannel(patch: number): Promise<Values>
  writePatch(values: Values): Promise<void>
  writeChannel(patch: number, values: Values): Promise<void>
  setDeltas(deltas: Record<string, number>): Promise<void>
  listTones(): Promise<unknown[]>
  saveTone(tone: unknown): Promise<void>
  deleteTone(id: string): Promise<void>
  loadDoc<T>(name: string): Promise<T | null>
  saveDoc(name: string, value: unknown): Promise<void>
  onAmpEvent(cb: (e: AmpEvent) => void): void
  readonly mock: boolean
}

// Every call except the frequent set_params is logged (with errors) to the app's log file.
async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const t0 = performance.now()
  const quiet = cmd === 'set_params' || cmd === 'log_line'
  try {
    const r = await invoke<T>(cmd, args)
    if (!quiet) log(`${cmd} ok (${Math.round(performance.now() - t0)} ms)`)
    return r
  } catch (e) {
    log(`${cmd} FAILED (${Math.round(performance.now() - t0)} ms): ${e}`)
    throw e
  }
}

export function log(line: string) {
  if ('__TAURI_INTERNALS__' in window) invoke('log_line', { line }).catch(() => {})
  else console.log(line)
}

const tauri: Backend = {
  mock: false,
  listPorts: () => call('list_ports'),
  connect: (port) => call('connect', { port: port ?? null }),
  disconnect: () => call('disconnect'),
  setParams: (values) => call('set_params', { values }),
  readPatch: () => call('read_patch'),
  readChannel: (patch) => call('read_channel', { patch }),
  writePatch: (values) => call('write_patch', { values }),
  writeChannel: (patch, values) => call('write_channel', { patch, values }),
  setDeltas: (deltas) => call('set_deltas', { deltas }),
  listTones: () => call('list_tones'),
  saveTone: (tone) => call('save_tone', { tone }),
  deleteTone: (id) => call('delete_tone', { id }),
  loadDoc: (name) => call('load_doc', { name }),
  saveDoc: (name, value) => call('save_doc', { name, value }),
  onAmpEvent: (cb) => {
    listen<AmpEvent>('amp-event', (e) => {
      if (e.payload.kind === 'disconnected') log(`event disconnected: ${e.payload.reason}`)
      cb(e.payload)
    })
  },
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const LS = 'katana-mock:'

function mockBackend(): Backend {
  let amp: Values = defaults()
  amp['com.name'] = 'MOCK AMP        '
  return {
    mock: true,
    listPorts: async () => ['KATANA3 (mock)'],
    connect: async () => (await sleep(300), 'KATANA3 (mock)'),
    disconnect: async () => {},
    setParams: async (v) => void Object.assign(amp, v),
    readPatch: async () => (await sleep(600), { ...amp }),
    readChannel: async (patch) => (await sleep(300), { ...defaults(), 'com.name': `CH ${patch} TONE`.padEnd(16, ' '), 'amp.gain': 20 + patch * 10 }),
    writePatch: async (v) => (await sleep(400), void (amp = { ...amp, ...v })),
    writeChannel: async () => void (await sleep(700)),
    setDeltas: async () => {},
    listTones: async () =>
      Object.keys(localStorage)
        .filter((k) => k.startsWith(LS + 'tone:'))
        .map((k) => JSON.parse(localStorage.getItem(k)!)),
    saveTone: async (t) => localStorage.setItem(LS + 'tone:' + (t as { id: string }).id, JSON.stringify(t)),
    deleteTone: async (id) => localStorage.removeItem(LS + 'tone:' + id),
    loadDoc: async <T,>(name: string) => {
      const s = localStorage.getItem(LS + name)
      return s ? (JSON.parse(s) as T) : null
    },
    saveDoc: async (name, value) => localStorage.setItem(LS + name, JSON.stringify(value)),
    // Dev hook: window.__ampEvent({ kind: 'patchSelected', number: 5 }) simulates the amp.
    onAmpEvent: (cb) => void ((window as unknown as Record<string, unknown>).__ampEvent = cb),
  }
}

export const backend: Backend = '__TAURI_INTERNALS__' in window ? tauri : mockBackend()
