// Talks to the Rust backend inside Tauri. Outside Tauri (plain browser, for UI development and
// screenshots) a mock backend stores data in localStorage and pretends an amp is attached.
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { defaults, type Value } from './schema'

export type Values = Record<string, Value>
export type AmpEvent = { kind: 'param'; id: string; value: Value } | { kind: 'disconnected'; reason: string }

export interface Backend {
  listPorts(): Promise<string[]>
  connect(port?: string): Promise<string>
  disconnect(): Promise<void>
  setParams(values: Values): Promise<void>
  readPatch(): Promise<Values>
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

const tauri: Backend = {
  mock: false,
  listPorts: () => invoke('list_ports'),
  connect: (port) => invoke('connect', { port: port ?? null }),
  disconnect: () => invoke('disconnect'),
  setParams: (values) => invoke('set_params', { values }),
  readPatch: () => invoke('read_patch'),
  writePatch: (values) => invoke('write_patch', { values }),
  writeChannel: (patch, values) => invoke('write_channel', { patch, values }),
  setDeltas: (deltas) => invoke('set_deltas', { deltas }),
  listTones: () => invoke('list_tones'),
  saveTone: (tone) => invoke('save_tone', { tone }),
  deleteTone: (id) => invoke('delete_tone', { id }),
  loadDoc: (name) => invoke('load_doc', { name }),
  saveDoc: (name, value) => invoke('save_doc', { name, value }),
  onAmpEvent: (cb) => {
    listen<AmpEvent>('amp-event', (e) => cb(e.payload))
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
    onAmpEvent: () => {},
  }
}

export const backend: Backend = '__TAURI_INTERNALS__' in window ? tauri : mockBackend()
