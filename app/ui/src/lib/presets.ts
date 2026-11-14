// Default tones that ship with the app: famous songs, genre starting points and a few fun
// ones. They are read-only; opening or copying one gives you your own editable tone.
//
// Each preset starts from preset-base.json (every setting BOSS's own Gen 3 livesets agree on:
// vintage cabinet, noise suppressor at 15, EQ 2 after the amp, every effect block off) plus a
// few blocks, written by name (amp type "Crunch", booster "T-SCREAM", ...) and checked against
// the schema when this module loads.
//
// Values follow how BOSS's factory patches and well-liked user patches are set on this amp:
// - Amp EQ: bass 60-72, middle 55-70 (lower only for scooped or funk sounds), treble 40-55,
//   presence 25-45. Treble and presence above ~60 sound harsh and fizzy on this amp.
// - Gain by amp: Clean 25-45, Pushed 45-75, Crunch 35-60 (it breaks up early), Lead ~60-65,
//   Brown 65-75. Volume is matched per amp: Clean ~65, Pushed/Crunch ~40, Lead ~30, Brown ~26.
// - The booster is a push into the amp, not the distortion: drive 5-25, effect level 55-75.
// - Reverb and delay levels are higher than you'd guess: reverb 25-45, delay 35-45.
// Guitars and pickups differ, so tweak by ear.
import type { Values } from './backend'
import BASE from './preset-base.json'
import { byId, defaults, type Value } from './schema'
import type { Tone } from './store.svelte'

/** Order the categories appear in the library. */
export const PRESET_CATEGORIES = ['Songs', 'Clean', 'Blues', 'Rock', 'Metal', 'Punk & alt', 'Funk & groove', 'Country', 'Jazz', 'Ambient', 'Fun'] as const
export type PresetCategory = (typeof PRESET_CATEGORIES)[number]

type V = Values
const problems: string[] = []

/** A blank patch as BOSS sets one up: every effect block off, noise suppressor on. */
export function presetBase(): V {
  return { ...defaults(), ...(BASE as V) }
}

/** Set a param by id; option params also take their option name. */
function put(v: V, id: string, value: Value) {
  const p = byId.get(id)
  if (!p) return void problems.push(`unknown param ${id}`)
  if (typeof value === 'string' && p.options) {
    const i = p.options.indexOf(value)
    if (i < 0) return void problems.push(`${id}: no option ${value}`)
    value = p.min + i
  }
  if (typeof value === 'number' && (value < p.min || value > p.max)) problems.push(`${id}: ${value} outside ${p.min}..${p.max}`)
  v[id] = value
}
const each = (v: V, prefix: string, o: Record<string, Value>) => Object.entries(o).forEach(([k, x]) => put(v, `${prefix}.${k}`, x))

// Effect type name -> its detail params' key in the schema.
const DETAIL: Record<string, string> = {
  'T.WAH': 'twah', 'AUTO WAH': 'awah', 'PEDAL WAH': 'pedalwah', COMP: 'comp', LIMITER: 'limiter', 'GRAPHIC EQ': 'geq',
  'GUITAR SIM': 'guitarsim', 'SLOW GEAR': 'slowgear', 'WAVE SYNTH': 'wavesynth', OCTAVE: 'octave', 'PITCH SHIFTER': 'pitchshift',
  HARMONIST: 'harmonist', PHASER: 'phaser', FLANGER: 'flanger', TREMOLO: 'tremolo', ROTARY: 'rotary', 'UNI-V': 'univ',
  SLICER: 'slicer', VIBRATO: 'vibrato', 'RING MOD': 'ringmod', HUMANIZER: 'humanizer', CHORUS: '2x2chorus',
  'AC.GUITAR SIM': 'acsim', 'PHASER 90E': 'ephaser', 'FLANGER 117E': 'eflanger', 'WAH 95E': 'ewah', 'DC-30': 'dc30',
  'HEAVY OCTAVE': 'heavyoctave', 'PEDAL BEND': 'bend',
}

// Blocks. Each uses its Green variation (booster1, fx1 for MOD, fx4 for FX, delay1, reverb1).
type AmpType = 'Acoustic' | 'Clean' | 'Pushed' | 'Crunch' | 'Lead' | 'Brown'
/** Patch volume per amp type, so presets come out at about the same loudness. */
const VOLUME: Record<AmpType, number> = { Acoustic: 70, Clean: 65, Pushed: 40, Crunch: 40, Lead: 30, Brown: 26 }
type Amp = {
  type: AmpType; gain: number; bass?: number; middle?: number; treble?: number; presence?: number; volume?: number
  /** Preamp / power amp Variation (on the Brown amp the preamp variation is tighter and more modern). */
  pre?: boolean; power?: boolean; cab?: 'VINTAGE' | 'MODERN' | 'DEEP'
}
const amp = (a: Amp) => (v: V) => {
  each(v, 'amp', { type: a.type, gain: a.gain, bass: a.bass ?? 62, middle: a.middle ?? 60, treble: a.treble ?? 48, presence: a.presence ?? 38, volume: a.volume ?? VOLUME[a.type] })
  if (a.pre) put(v, 'amp.preamp_variation', 'Variation')
  if (a.power) put(v, 'amp.poweramp_variation', 'Variation')
  if (a.cab) put(v, 'other.cabinet_resonance', a.cab)
}
/** The CONTOUR knob (1-3 are preset mid/treble shapes; BOSS uses 1 on most driven sounds). */
const contour = (knob: 1 | 2 | 3) => (v: V) => put(v, 'contour_com.knob', String(knob))
const boost = (type: string, o: { drive?: number; tone?: number; bottom?: number; level?: number; mix?: number } = {}) => (v: V) => {
  put(v, 'sw.booster_sw', 1)
  put(v, 'color.booster_color', 'Green')
  each(v, 'booster1', { type, drive: o.drive ?? 10, tone: o.tone ?? 0, bottom: o.bottom ?? 15, effect_level: o.level ?? 65, direct_mix: o.mix ?? 0 })
}
const effect = (slot: 'mod' | 'fx') => (type: string, detail: Record<string, Value> = {}) => (v: V) => {
  const n = slot === 'mod' ? 1 : 4
  put(v, `sw.${slot}_sw`, 1)
  put(v, `color.${slot}_color`, 'Green')
  put(v, `fx${n}.type`, type)
  each(v, `fx_detail${n}.${DETAIL[type]}`, detail)
}
const mod = effect('mod')
const fx = effect('fx')
const delay = (type: string, time: number, feedback = 32, level = 40, extra: Record<string, Value> = {}) => (v: V) => {
  put(v, 'sw.delay_sw', 1)
  put(v, 'color.delay_color', 'Green')
  each(v, 'delay1', { type, time, feedback, effect_level: level, high_cut: '6.30 kHz', ...extra })
}
/** Halls and modulated reverbs get BOSS's full-range setting (low cut 25 Hz, density 10). */
const reverb = (type: string, time = 30, level = 35, extra: Record<string, Value> = {}) => (v: V) => {
  put(v, 'sw.reverb_sw', 1)
  put(v, 'color.reverb_color', 'Green')
  const big = type === 'HALL' || type === 'MODULATE'
  each(v, 'reverb1', { type, time, effect_level: level, layer_mode: 'REVERB', low_cut: big ? '25.0 Hz' : '400 Hz', density: big ? 10 : 5, ...extra })
}
/** Noise suppressor: 15 suits clean and crunch; high gain needs 35-55. */
const gate = (threshold: number, release = 50) => (v: V) => each(v, 'ns', { sw: 1, threshold, release })

function preset(name: string, category: PresetCategory, notes: string, ...blocks: ((v: V) => void)[]): Tone {
  const v = presetBase()
  for (const b of blocks) b(v)
  put(v, 'com.name', name.replace(/[^\x20-\x7d]/g, ' ').slice(0, 16).padEnd(16, ' '))
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return {
    id: `preset:${slug}`, schema: 1, name, author: 'Katana Studio', tags: [category], notes,
    created: '2026-11-14T00:00:00.000Z', modified: '2026-11-14T00:00:00.000Z',
    device: { model: 'KATANA Gen3' }, params: v, builtin: true,
  }
}

export const presets: Tone[] = [
  // ------------------------------------------------------------------ songs
  preset('Sweet Child O\' Mine', 'Songs',
    "Guns N' Roses (Slash): Les Paul into a hot-rodded Marshall, big mids and a lush plate. Neck pickup for the intro riff, bridge for the solos.",
    amp({ type: 'Brown', gain: 67, bass: 68, middle: 69, treble: 62, presence: 48, volume: 30 }),
    contour(1), reverb('PLATE', 50, 50, { density: 8 }), gate(30)),
  preset('Back in Black', 'Songs',
    'AC/DC: Gibson SG into a cranked Marshall, no pedals. Less gain than you think; dig in with the pick.',
    amp({ type: 'Crunch', gain: 55, bass: 62, middle: 66, treble: 52, presence: 40 }),
    contour(1), reverb('ROOM', 25, 25), gate(20)),
  preset('Smoke on the Water', 'Songs',
    'Deep Purple (Blackmore): Strat into a treble-boosted, overdriven Marshall. Play the riff in fourths with fingers.',
    amp({ type: 'Crunch', gain: 52, bass: 60, middle: 66, treble: 50, presence: 38 }),
    boost('TREBLE BOOST', { drive: 12, tone: 5, bottom: 0, level: 62 }), contour(1), reverb('ROOM', 25, 25)),
  preset('Teen Spirit verse', 'Songs',
    'Nirvana: the clean, chorused verse (EHX Small Clone). Pair with "Teen Spirit chorus" on the next channel.',
    amp({ type: 'Clean', gain: 35, bass: 62, middle: 45, treble: 55, presence: 42 }),
    mod('CHORUS', { low_rate: 40, high_rate: 33, low_depth: 65, high_depth: 60, direct_mix: 80 }), reverb('ROOM', 25, 25)),
  preset('Teen Spirit chorus', 'Songs',
    'Nirvana: the loud part. A DS-1 into a crunchy amp; mids slightly scooped, lots of low end.',
    amp({ type: 'Lead', gain: 62, bass: 66, middle: 48, treble: 52, presence: 35 }),
    boost('DISTORTION', { drive: 15, level: 60 }), contour(1), gate(40)),
  preset('Comfortably Numb solo', 'Songs',
    'Pink Floyd (Gilmour): smooth, singing sustain with a long echo and a big hall. Neck pickup, slow wide bends.',
    amp({ type: 'Lead', gain: 64, bass: 65, middle: 58, treble: 50, presence: 30 }),
    boost('MUFF FUZZ', { drive: 18, tone: -5, level: 62 }), contour(1),
    delay('TAPE ECHO', 440, 32, 40), reverb('HALL', 45, 40), gate(25)),
  preset('Streets Have No Name', 'Songs',
    'U2 (The Edge): AC30 chime and a loud dotted-eighth delay (~375 ms at ~125 bpm). Mute the strings and let the delay fill in.',
    amp({ type: 'Pushed', gain: 50, bass: 60, middle: 60, treble: 55, presence: 45 }),
    delay('DIGITAL', 375, 35, 55), reverb('PLATE', 30, 25)),
  preset('Master of Puppets', 'Songs',
    'Metallica: tight scooped thrash. A Metal Zone barely on tightens the low end; gate on for the stops.',
    amp({ type: 'Brown', gain: 68, bass: 72, middle: 35, treble: 62, presence: 40, pre: true, power: true }),
    boost('METAL ZONE', { drive: 4, bottom: 17, tone: -26, level: 53 }), contour(2), gate(45, 36)),
  preset('Paranoid', 'Songs',
    'Black Sabbath (Iommi): treble booster into a Laney turned all the way up. Thin bass, loud mids and top.',
    amp({ type: 'Crunch', gain: 85, bass: 20, middle: 69, treble: 70, presence: 62, volume: 32 }),
    boost('TREBLE BOOST', { drive: 11, bottom: -5, level: 56 }), contour(3), reverb('ROOM', 20, 40, { density: 3 }), gate(25)),
  preset('Purple Haze', 'Songs',
    'Jimi Hendrix: Octavia fuzz (octave-up) into a Marshall. Neck pickup for the octave to really sing.',
    amp({ type: 'Crunch', gain: 48, bass: 62, middle: 62, treble: 48, presence: 38 }),
    boost('OCT FUZZ', { drive: 30, level: 60 }), reverb('SPRING', 30, 25)),
  preset('Little Wing', 'Songs',
    'Jimi Hendrix: clean, bell-like neck pickup through a slow Leslie.',
    amp({ type: 'Clean', gain: 42, bass: 62, middle: 55, treble: 55, presence: 45 }),
    mod('ROTARY', { rate: 30, depth: 55 }), reverb('SPRING', 30, 32)),
  preset('Pride and Joy', 'Songs',
    'Stevie Ray Vaughan: Strat with heavy strings into a Tube Screamer and a loud Fender, dark and fat. Neck or middle pickup.',
    amp({ type: 'Crunch', gain: 40, bass: 70, middle: 70, treble: 32, presence: 30, pre: true }),
    boost('T-SCREAM', { drive: 10, bottom: 20, level: 72 }), contour(1),
    delay('TAPE ECHO', 130, 30, 30), reverb('SPRING', 30, 22)),
  preset('Hotel California solo', 'Songs',
    'Eagles (Felder/Walsh): smooth singing lead with echo. Bridge pickup, lots of vibrato.',
    amp({ type: 'Lead', gain: 61, bass: 65, middle: 60, treble: 50, presence: 30 }),
    boost('CLEAN BOOST', { drive: 15, bottom: 23, level: 72 }), contour(1),
    delay('TAPE ECHO', 350, 30, 38), reverb('HALL', 30, 38)),
  preset('Sultans of Swing', 'Songs',
    'Dire Straits (Knopfler): clean Strat in the neck+middle position, fingerpicked, lightly compressed.',
    amp({ type: 'Clean', gain: 42, bass: 60, middle: 52, treble: 60, presence: 50 }),
    mod('COMP', { type: 'BOSS COMP', sustain: 41, attack: 50, tone: 0, level: 38 }), reverb('ROOM', 25, 28)),
  preset('Money for Nothing', 'Songs',
    'Dire Straits (Knopfler): the "cocked wah" honk: no bass, a fixed band-pass filter and a big hall.',
    amp({ type: 'Lead', gain: 60, bass: 5, middle: 70, treble: 72, presence: 40 }),
    fx('T.WAH', { mode: 'BPF', polarity: 'UP', sens: 0, freq: 50, peak: 0, direct_mix: 0, effect_level: 50 }),
    reverb('HALL', 40, 45, { high_cut: '3.15 kHz' }), gate(25)),
  preset('Every Breath You Take', 'Songs',
    'The Police (Summers): bright, compressed arpeggios with lush chorus and a short echo. Let every note ring.',
    amp({ type: 'Pushed', gain: 32, bass: 50, middle: 53, treble: 65, presence: 52, pre: true, volume: 55 }),
    mod('CHORUS', { low_rate: 44, low_depth: 55, low_level: 75, high_rate: 33, high_depth: 54, high_level: 65, direct_mix: 80 }),
    fx('COMP', { type: 'BOSS COMP', sustain: 60, attack: 70, tone: 0, level: 40 }),
    delay('ANALOG', 136, 30, 27, { direct_level: 100, high_cut: '4.00 kHz' }), reverb('HALL', 25, 40)),
  preset('Under the Bridge', 'Songs',
    'Red Hot Chili Peppers (Frusciante): clean Strat, neck/middle positions, a little compression and room.',
    amp({ type: 'Clean', gain: 42, bass: 60, middle: 55, treble: 55, presence: 45 }),
    mod('COMP', { type: 'LIGHT', sustain: 35, attack: 50, level: 40 }), reverb('ROOM', 30, 30)),
  preset('Seven Nation Army', 'Songs',
    'The White Stripes: fuzz plus a Whammy one octave down, so a guitar plays the "bass" riff. Play it on the A string.',
    amp({ type: 'Lead', gain: 60, bass: 66, middle: 60, treble: 48, presence: 32 }),
    boost('MUFF FUZZ', { drive: 20, level: 62 }),
    fx('PITCH SHIFTER', { voice: '1VOICE', pitch1: -12, fine1: 0, level1: 100, direct_mix: 20 }), gate(30)),
  preset('Eruption', 'Songs',
    'Van Halen: the "brown sound", a cranked Marshall with an MXR Phase 90, echo and reverb.',
    amp({ type: 'Brown', gain: 74, bass: 65, middle: 60, treble: 54, presence: 30 }),
    fx('PHASER 90E', { script: 1, speed: 30 }), contour(1),
    delay('TAPE ECHO', 350, 22, 28), reverb('HALL', 30, 40), gate(35)),
  preset('Johnny B. Goode', 'Songs',
    'Chuck Berry: a small amp just breaking up with a slapback echo. Double-stop the intro, dig in hard.',
    amp({ type: 'Pushed', gain: 56, bass: 70, middle: 60, treble: 45, presence: 44 }),
    contour(1), delay('TAPE ECHO', 130, 32, 40), reverb('SPRING', 30, 30)),
  preset('Wonderwall', 'Songs',
    'Oasis: strummed acoustic. The Acoustic amp plus the AC.Guitar Sim turns an electric into a convincing acoustic.',
    amp({ type: 'Acoustic', gain: 56, bass: 50, middle: 60, treble: 60, presence: 60 }),
    fx('AC.GUITAR SIM', { high: 28, body: 50, low: -16, level: 50 }), reverb('PLATE', 30, 45)),
  preset('Black Hole Sun', 'Songs',
    'Soundgarden: the verse arpeggios through a Leslie, just on the edge of breakup. Drop-D tuning.',
    amp({ type: 'Crunch', gain: 33, bass: 65, middle: 50, treble: 50, presence: 36 }),
    mod('ROTARY', { rate: 35, depth: 60 }), reverb('ROOM', 30, 28)),
  preset('Crazy Train', 'Songs',
    'Ozzy Osbourne (Randy Rhoads): a Distortion+ pushing a Marshall, tight and mid-forward.',
    amp({ type: 'Lead', gain: 64, bass: 65, middle: 64, treble: 52, presence: 32 }),
    boost('DST+', { drive: 15, level: 65 }), contour(1), delay('TAPE ECHO', 360, 20, 25), gate(40)),
  preset('Satisfaction', 'Songs',
    "The Rolling Stones (Keith Richards): the Maestro Fuzz-Tone riff into a clean amp. Brash and buzzy.",
    amp({ type: 'Clean', gain: 40, bass: 60, middle: 55, treble: 50, presence: 40, volume: 50 }),
    boost("'60S FUZZ", { drive: 40, tone: 10, bottom: 0, level: 60 })),
  preset('Sunshine of Your Love', 'Songs',
    'Cream (Clapton): the "woman tone", neck pickup with the guitar\'s tone knob rolled off into a cranked Marshall.',
    amp({ type: 'Lead', gain: 68, bass: 65, middle: 66, treble: 25, presence: 25 }),
    reverb('ROOM', 25, 28), gate(25)),
  preset('Killing in the Name', 'Songs',
    'Rage Against the Machine (Morello): Drop-D crunch. Switch FX on for the Whammy (+1 octave) solo.',
    amp({ type: 'Lead', gain: 65, bass: 66, middle: 60, treble: 50, presence: 35, pre: true }),
    fx('PITCH SHIFTER', { voice: '1VOICE', pitch1: 12, fine1: 0, level1: 100, direct_mix: 0 }),
    (v) => put(v, 'sw.fx_sw', 0), contour(1), gate(45)),

  // ------------------------------------------------------------------ clean
  preset('Glassy Clean', 'Clean',
    'Sparkly studio clean: compressed, a little chorus and a hall. Great for arpeggios.',
    amp({ type: 'Clean', gain: 40, bass: 63, middle: 41, treble: 63, presence: 53, volume: 70 }),
    mod('COMP', { type: 'BOSS COMP', sustain: 41, attack: 50, tone: 0, level: 35 }),
    fx('CHORUS', { low_rate: 25, high_rate: 25, low_depth: 40, high_depth: 40, direct_mix: 80 }), reverb('HALL', 30, 35)),
  preset('Surf Reverb', 'Clean',
    'Dick Dale / Ventures: drippy spring reverb cranked up. Fast tremolo picking.',
    amp({ type: 'Clean', gain: 42, bass: 55, middle: 50, treble: 60, presence: 48 }),
    reverb('SPRING', 70, 65, { spring_color: 100 })),

  // ------------------------------------------------------------------ blues
  preset('Chicago Blues', 'Blues',
    'A small tweed amp on the edge of breakup. Clean when you play soft, gritty when you dig in.',
    amp({ type: 'Pushed', gain: 58, bass: 70, middle: 68, treble: 42, presence: 38 }),
    contour(1), reverb('SPRING', 30, 32)),
  preset('Slow Blues Lead', 'Blues',
    'Singing, sustaining lead for slow blues: an overdrive pushing a pushed amp, with echo.',
    amp({ type: 'Pushed', gain: 66, bass: 72, middle: 60, treble: 43, presence: 41, volume: 30 }),
    boost('BLUES DRIVE', { drive: 15, bottom: 20, level: 70 }), contour(1),
    delay('TAPE ECHO', 380, 25, 32), reverb('SPRING', 30, 30)),

  // ------------------------------------------------------------------ rock
  preset('Classic Rock Lead', 'Rock',
    '70s/80s rock lead: a hot Marshall with a clean boost, tape echo and a hall.',
    amp({ type: 'Lead', gain: 61, bass: 65, middle: 60, treble: 52, presence: 27 }),
    boost('CLEAN BOOST', { drive: 23, bottom: 23, level: 75 }), contour(1),
    delay('TAPE ECHO', 370, 32, 38), reverb('HALL', 30, 38)),
  preset('80s Hair Metal Lead', 'Rock',
    'Big 80s solo tone: saturated amp, chorus, long delay and plate reverb.',
    amp({ type: 'Brown', gain: 73, bass: 62, middle: 60, treble: 55, presence: 32 }),
    mod('CHORUS', { low_rate: 35, high_rate: 35, low_depth: 45, high_depth: 45, direct_mix: 80 }), contour(1),
    delay('DIGITAL', 420, 30, 35), reverb('PLATE', 40, 35), gate(40)),

  // ------------------------------------------------------------------ metal
  preset('Modern Metal Rhythm', 'Metal',
    'Tight modern high gain: a Tube Screamer with almost no drive tightening a modern amp, with a firm gate.',
    amp({ type: 'Brown', gain: 62, bass: 58, middle: 58, treble: 62, presence: 50, pre: true, cab: 'MODERN' }),
    boost('T-SCREAM', { drive: 8, tone: 20, bottom: 0, level: 65 }), contour(2), gate(50, 10)),
  preset('Swedish Chainsaw', 'Metal',
    'Old-school Swedish death metal (Entombed): a BOSS HM-2 into a driven amp.',
    amp({ type: 'Crunch', gain: 45, bass: 66, middle: 40, treble: 55, presence: 35, volume: 35 }),
    boost('HM-2', { drive: 45, tone: 25, bottom: 10, level: 60 }), gate(50)),
  preset('Doom Fuzz', 'Metal',
    'Sleep / Electric Wizard style doom: thick fuzz, big bass, slow riffs in low tunings.',
    amp({ type: 'Brown', gain: 55, bass: 75, middle: 55, treble: 40, presence: 28, volume: 28 }),
    boost('MUFF FUZZ', { drive: 40, tone: -10, bottom: 20, level: 60 }), reverb('HALL', 35, 30), gate(40)),

  // ------------------------------------------------------------------ punk & alt
  preset('Pop Punk', 'Punk & alt',
    'Green Day / Blink-182: saturated crunch with full lows for power chords.',
    amp({ type: 'Brown', gain: 65, bass: 66, middle: 58, treble: 55, presence: 38, pre: true }),
    contour(1), gate(40)),
  preset('90s Grunge', 'Punk & alt',
    'Big, slightly messy fuzz-distortion (Smashing Pumpkins / Mudhoney). Works on chords and leads.',
    amp({ type: 'Crunch', gain: 60, bass: 66, middle: 48, treble: 50, presence: 35, volume: 36 }),
    boost('MUFF FUZZ', { drive: 25, level: 60 }), reverb('ROOM', 20, 22), gate(35)),
  preset('Shoegaze Wall', 'Punk & alt',
    'My Bloody Valentine style: fuzz into a huge modulated reverb. Strum and bend the whammy bar.',
    amp({ type: 'Crunch', gain: 50, bass: 62, middle: 55, treble: 50, presence: 35, volume: 35 }),
    boost('MUFF FUZZ', { drive: 40, tone: -5, level: 55 }),
    mod('VIBRATO', { rate: 30, depth: 35 }), reverb('MODULATE', 80, 60), gate(30)),

  // ------------------------------------------------------------------ funk & groove
  preset('Funk Rhythm', 'Funk & groove',
    'Nile Rodgers / James Brown chank: scooped, compressed, barely crunchy; single-coil middle or bridge.',
    amp({ type: 'Crunch', gain: 33, bass: 67, middle: 29, treble: 59, presence: 36, pre: true }),
    mod('COMP', { type: 'BOSS COMP', sustain: 55, attack: 65, tone: 0, level: 40 }), contour(1), reverb('SPRING', 30, 14)),
  preset('Auto-Wah Funk', 'Funk & groove',
    'Envelope-filter funk (Mu-Tron style): the harder you pick, the more it quacks.',
    amp({ type: 'Clean', gain: 38, bass: 60, middle: 50, treble: 55, presence: 45 }),
    mod('COMP', { type: 'BOSS COMP', sustain: 45, attack: 60, level: 40 }),
    fx('T.WAH', { mode: 'BPF', polarity: 'UP', sens: 60, freq: 30, peak: 55, effect_level: 60 })),
  preset('Reggae Skank', 'Funk & groove',
    'Off-beat reggae chops: thin, bright and tight with a short spring.',
    amp({ type: 'Clean', gain: 35, bass: 40, middle: 65, treble: 58, presence: 45 }),
    reverb('SPRING', 20, 25)),

  // ------------------------------------------------------------------ country
  preset('Chicken Pickin\'', 'Country',
    'Telecaster country: bright, compressed, with a single slapback repeat. Hybrid picking.',
    amp({ type: 'Clean', gain: 42, bass: 60, middle: 50, treble: 62, presence: 48 }),
    mod('COMP', { type: 'BOSS COMP', sustain: 50, attack: 65, level: 40 }),
    delay('TAPE ECHO', 130, 10, 38), reverb('SPRING', 30, 20)),

  // ------------------------------------------------------------------ jazz
  preset('Jazz Box', 'Jazz',
    'Warm archtop jazz: neck pickup, treble down, round and dark. A little room.',
    amp({ type: 'Clean', gain: 35, bass: 65, middle: 55, treble: 30, presence: 25 }),
    reverb('ROOM', 25, 25)),

  // ------------------------------------------------------------------ ambient
  preset('Ambient Swells', 'Ambient',
    'Volume swells (Slow Gear) into an analog delay and a big modulated reverb: pad-like soundscapes.',
    amp({ type: 'Clean', gain: 27, bass: 53, middle: 87, treble: 63, presence: 53, volume: 61 }),
    mod('SLOW GEAR', { sens: 50, rise_time: 60 }),
    delay('ANALOG', 364, 32, 45, { high_cut: '4.00 kHz' }), reverb('MODULATE', 30, 60)),
  preset('Post-Rock Shimmer', 'Ambient',
    'Explosions in the Sky style: chimey pushed clean with long modulated delay and reverb.',
    amp({ type: 'Pushed', gain: 45, bass: 66, middle: 65, treble: 50, presence: 32 }),
    delay('MODULATE', 450, 45, 45), reverb('MODULATE', 60, 55)),

  // ------------------------------------------------------------------ fun
  preset('Synth Lead', 'Fun',
    'Turns single notes into an analog-style saw synth. Play one note at a time.',
    amp({ type: 'Clean', gain: 35, bass: 60, middle: 50, treble: 50, presence: 40 }),
    fx('WAVE SYNTH', { wave: 'SAW', cutoff: 45, resonance: 50, filter_sens: 60, filter_decay: 55, filter_depth: 60, synth_level: 70, direct_mix: 0 }),
    delay('DIGITAL', 300, 25, 30)),
  preset('Robot Ring Mod', 'Fun',
    'Metallic, bell-like, out-of-tune robot sounds. Try slow bends.',
    amp({ type: 'Crunch', gain: 35, bass: 62, middle: 55, treble: 50, presence: 38 }),
    fx('RING MOD', { mode: 'INTELLIGENT', frequency: 60, effect_level: 100, direct_mix: 30 })),
  preset('Talking Guitar', 'Fun',
    'A talk-box-like vowel filter ("ah-ee") that follows your picking.',
    amp({ type: 'Crunch', gain: 45, bass: 62, middle: 62, treble: 48, presence: 38 }),
    fx('HUMANIZER', { mode: 'PICKING', vowel1: 'a', vowel2: 'i', sens: 60, level: 100 })),
  preset('Octave Bass', 'Fun',
    'Adds one and two octaves down under your playing: play bass lines on a guitar.',
    amp({ type: 'Clean', gain: 35, bass: 65, middle: 50, treble: 40, presence: 30 }),
    fx('HEAVY OCTAVE', { '1oct_level': 80, '2oct_level': 40, direct_mix: 40 })),
  preset('Reverse Dream', 'Fun',
    'Backwards delay: each note swells in after you play it. Slow, sparse lines.',
    amp({ type: 'Clean', gain: 35, bass: 60, middle: 50, treble: 55, presence: 45 }),
    delay('REVERSE', 500, 30, 60), reverb('HALL', 50, 40)),
]

if (problems.length) console.warn('preset problems:\n' + problems.join('\n'))
