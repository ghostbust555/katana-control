// Default tones that ship with the app: famous songs, genre starting points and a few fun
// ones. They are read-only; opening or copying one gives you your own editable tone.
//
// Each preset is built from the amp defaults plus a few blocks, written by name (amp type
// "Crunch", booster "T-SCREAM", ...) and checked against the schema when this module loads.
// Settings are starting points from the original gear (pedals, amps, delay times), not
// measurements: guitars and pickups differ, so tweak by ear.
import type { Values } from './backend'
import { byId, defaults, type Value } from './schema'
import type { Tone } from './store.svelte'

/** Order the categories appear in the library. */
export const PRESET_CATEGORIES = ['Songs', 'Clean', 'Blues', 'Rock', 'Metal', 'Punk & alt', 'Funk & groove', 'Country', 'Jazz', 'Ambient', 'Fun'] as const
export type PresetCategory = (typeof PRESET_CATEGORIES)[number]

type V = Values
const problems: string[] = []

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
type Amp = { type: string; gain: number; bass?: number; middle?: number; treble?: number; presence?: number; volume?: number; variation?: boolean }
const amp = (a: Amp) => (v: V) => {
  each(v, 'amp', { type: a.type, gain: a.gain, bass: a.bass ?? 50, middle: a.middle ?? 50, treble: a.treble ?? 50, presence: a.presence ?? 50, volume: a.volume ?? 50 })
  if (a.variation) put(v, 'amp.preamp_variation', 'Variation')
}
const boost = (type: string, o: { drive: number; tone?: number; bottom?: number; level?: number; mix?: number }) => (v: V) => {
  put(v, 'sw.booster_sw', 1)
  put(v, 'color.booster_color', 'Green')
  each(v, 'booster1', { type, drive: o.drive, tone: o.tone ?? 0, bottom: o.bottom ?? 0, effect_level: o.level ?? 50, direct_mix: o.mix ?? 0 })
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
const delay = (type: string, time: number, feedback: number, level: number, extra: Record<string, Value> = {}) => (v: V) => {
  put(v, 'sw.delay_sw', 1)
  put(v, 'color.delay_color', 'Green')
  each(v, 'delay1', { type, time, feedback, effect_level: level, ...extra })
}
const reverb = (type: string, time: number, level: number, extra: Record<string, Value> = {}) => (v: V) => {
  put(v, 'sw.reverb_sw', 1)
  put(v, 'color.reverb_color', 'Green')
  each(v, 'reverb1', { type, time, effect_level: level, layer_mode: 'REVERB', ...extra })
}
const gate = (threshold: number, release = 40) => (v: V) => each(v, 'ns', { sw: 1, threshold, release })

function preset(name: string, category: PresetCategory, notes: string, ...blocks: ((v: V) => void)[]): Tone {
  const v: V = { ...defaults() }
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
    "Guns N' Roses (Slash): Les Paul into a hot-rodded Marshall. Neck pickup for the intro riff, bridge for the solos.",
    amp({ type: 'Brown', gain: 55, bass: 55, middle: 65, treble: 60, presence: 45 }),
    delay('ANALOG', 380, 15, 22), reverb('ROOM', 25, 18)),
  preset('Back in Black', 'Songs',
    'AC/DC: Gibson SG into a cranked Marshall, no pedals. Less gain than you think; dig in with the pick.',
    amp({ type: 'Crunch', gain: 45, bass: 45, middle: 65, treble: 65, presence: 55 }),
    reverb('ROOM', 15, 12)),
  preset('Smoke on the Water', 'Songs',
    'Deep Purple (Blackmore): Strat into a treble-boosted, overdriven Marshall. Play the riff in fourths with fingers.',
    amp({ type: 'Crunch', gain: 55, bass: 50, middle: 60, treble: 55, presence: 50 }),
    boost('TREBLE BOOST', { drive: 45, tone: 10, level: 55 }), reverb('ROOM', 20, 15)),
  preset('Teen Spirit verse', 'Songs',
    'Nirvana: the clean, chorused verse (EHX Small Clone). Pair with "Teen Spirit chorus" on the next channel.',
    amp({ type: 'Clean', gain: 40, bass: 50, middle: 45, treble: 55, presence: 45 }),
    mod('CHORUS', { low_rate: 30, high_rate: 30, low_depth: 65, high_depth: 65, direct_mix: 60 }), reverb('ROOM', 20, 15)),
  preset('Teen Spirit chorus', 'Songs',
    'Nirvana: the loud part. A BOSS DS-1 style distortion into a crunchy amp; mids slightly scooped.',
    amp({ type: 'Crunch', gain: 45, bass: 60, middle: 40, treble: 60, presence: 55 }),
    boost('DISTORTION', { drive: 70, tone: 5, level: 55 }), gate(20)),
  preset('Comfortably Numb solo', 'Songs',
    'Pink Floyd (Gilmour): Big Muff into a clean, loud Hiwatt with a long digital delay and big hall. Neck pickup, slow wide bends.',
    amp({ type: 'Clean', gain: 60, bass: 50, middle: 55, treble: 55, presence: 50 }),
    boost('MUFF FUZZ', { drive: 65, tone: 5, level: 50 }),
    delay('DIGITAL', 440, 25, 35), reverb('HALL', 50, 30)),
  preset('Streets Have No Name', 'Songs',
    'U2 (The Edge): AC30 chime and a dotted-eighth delay (~375 ms at the song\'s ~125 bpm). Mute the strings and let the delay fill in.',
    amp({ type: 'Pushed', gain: 35, bass: 45, middle: 50, treble: 65, presence: 60 }),
    delay('DIGITAL', 375, 35, 65), reverb('PLATE', 25, 18)),
  preset('Master of Puppets', 'Songs',
    'Metallica: tight scooped thrash. A Tube Screamer with drive at zero tightens the low end; gate on for the stops.',
    amp({ type: 'Brown', gain: 70, bass: 65, middle: 35, treble: 65, presence: 55, volume: 45 }),
    boost('T-SCREAM', { drive: 10, tone: 10, level: 70 }), gate(35)),
  preset('Paranoid', 'Songs',
    'Black Sabbath (Iommi): treble booster into a Laney. Fat mids, slightly dark top.',
    amp({ type: 'Lead', gain: 60, bass: 55, middle: 70, treble: 50, presence: 45 }),
    boost('TREBLE BOOST', { drive: 60, tone: 5, level: 55 }), gate(15)),
  preset('Purple Haze', 'Songs',
    'Jimi Hendrix: Octavia fuzz (octave-up) into a Marshall. Neck pickup for the octave to really sing.',
    amp({ type: 'Crunch', gain: 55, bass: 55, middle: 55, treble: 55, presence: 50 }),
    boost('OCT FUZZ', { drive: 70, tone: 0, level: 50 }), reverb('ROOM', 20, 15)),
  preset('Little Wing', 'Songs',
    'Jimi Hendrix: clean, bell-like neck pickup through a slow Leslie.',
    amp({ type: 'Clean', gain: 55, bass: 50, middle: 55, treble: 55, presence: 50 }),
    mod('ROTARY', { rate: 30, depth: 55, level: 50 }), reverb('SPRING', 30, 25)),
  preset('Pride and Joy', 'Songs',
    'Stevie Ray Vaughan: Strat with heavy strings into a Tube Screamer and a loud Fender. Neck or middle pickup.',
    amp({ type: 'Crunch', gain: 35, bass: 55, middle: 60, treble: 55, presence: 55 }),
    boost('T-SCREAM', { drive: 25, tone: 10, level: 70 }), reverb('SPRING', 30, 25)),
  preset('Hotel California solo', 'Songs',
    'Eagles (Felder/Walsh): smooth singing lead with a touch of delay. Bridge pickup, lots of vibrato.',
    amp({ type: 'Lead', gain: 55, bass: 50, middle: 65, treble: 55, presence: 50 }),
    delay('ANALOG', 350, 20, 25), reverb('HALL', 35, 22)),
  preset('Sultans of Swing', 'Songs',
    'Dire Straits (Knopfler): clean Strat in the neck+middle position, fingerpicked, lightly compressed.',
    amp({ type: 'Clean', gain: 45, bass: 45, middle: 55, treble: 60, presence: 55 }),
    mod('COMP', { type: 'BOSS COMP', sustain: 35, attack: 50, level: 50 }), reverb('ROOM', 25, 22)),
  preset('Money for Nothing', 'Songs',
    'Dire Straits (Knopfler): the "cocked wah" honk, a wah parked half-way into a crunchy Les Paul tone.',
    amp({ type: 'Lead', gain: 50, bass: 35, middle: 80, treble: 45, presence: 45 }),
    fx('PEDAL WAH', { wah_type: 'CRY WAH', pedal_position: 55, effect_level: 100 }), reverb('ROOM', 20, 12)),
  preset('Every Breath You Take', 'Songs',
    'The Police (Summers): clean, compressed arpeggios with lush chorus. Let every note ring.',
    amp({ type: 'Clean', gain: 45, bass: 45, middle: 50, treble: 60, presence: 55 }),
    mod('CHORUS', { low_rate: 35, high_rate: 35, low_depth: 55, high_depth: 55, direct_mix: 70 }),
    fx('COMP', { type: 'BOSS COMP', sustain: 45, attack: 55, level: 50 }), reverb('PLATE', 30, 25)),
  preset('Under the Bridge', 'Songs',
    'Red Hot Chili Peppers (Frusciante): clean Strat, neck/middle positions, a little compression and room.',
    amp({ type: 'Clean', gain: 50, bass: 50, middle: 55, treble: 55, presence: 50 }),
    mod('COMP', { type: 'LIGHT', sustain: 35, attack: 50, level: 50 }), reverb('ROOM', 30, 25)),
  preset('Seven Nation Army', 'Songs',
    'The White Stripes: fuzz plus a Whammy one octave down, so a guitar plays the "bass" riff. Play it on the A string.',
    amp({ type: 'Lead', gain: 55, bass: 60, middle: 60, treble: 50, presence: 45 }),
    boost('MUFF FUZZ', { drive: 55, tone: 0, level: 50 }),
    fx('PITCH SHIFTER', { voice: '1VOICE', pitch1: -12, fine1: 0, level1: 100, direct_mix: 30 })),
  preset('Eruption', 'Songs',
    'Van Halen: the "brown sound", a cranked Marshall with an MXR Phase 90 and plate reverb.',
    amp({ type: 'Brown', gain: 75, bass: 55, middle: 60, treble: 65, presence: 55 }),
    fx('PHASER 90E', { script: 1, speed: 30 }), reverb('PLATE', 40, 30)),
  preset('Johnny B. Goode', 'Songs',
    'Chuck Berry: a small tweed amp just breaking up. Double-stop the intro, dig in hard.',
    amp({ type: 'Pushed', gain: 45, bass: 45, middle: 60, treble: 60, presence: 50 }),
    reverb('SPRING', 20, 18)),
  preset('Wonderwall', 'Songs',
    'Oasis: strummed acoustic. Turns an electric into a convincing acoustic with the AC.Guitar Sim.',
    amp({ type: 'Clean', gain: 35, bass: 45, middle: 50, treble: 60, presence: 55 }),
    fx('AC.GUITAR SIM', { high: 10, body: 60, low: 0, level: 55 }), reverb('ROOM', 30, 25)),
  preset('Black Hole Sun', 'Songs',
    'Soundgarden: the verse arpeggios through a Leslie. Drop-D tuning.',
    amp({ type: 'Crunch', gain: 35, bass: 50, middle: 55, treble: 55, presence: 50 }),
    mod('ROTARY', { rate: 40, depth: 65, level: 50 }), reverb('ROOM', 25, 20)),
  preset('Crazy Train', 'Songs',
    'Ozzy Osbourne (Randy Rhoads): MXR Distortion+ into a Marshall, tight and mid-forward.',
    amp({ type: 'Lead', gain: 60, bass: 50, middle: 65, treble: 60, presence: 55 }),
    boost('DST+', { drive: 55, tone: 5, level: 55 }), delay('ANALOG', 360, 15, 15), gate(25)),
  preset('Satisfaction', 'Songs',
    "The Rolling Stones (Keith Richards): the Maestro Fuzz-Tone riff into a clean amp. Brash and buzzy.",
    amp({ type: 'Clean', gain: 50, bass: 50, middle: 55, treble: 55, presence: 50 }),
    boost("'60S FUZZ", { drive: 80, tone: 10, level: 50 })),
  preset('Sunshine of Your Love', 'Songs',
    'Cream (Clapton): the "woman tone", neck pickup with the guitar\'s tone knob rolled off into a cranked Marshall.',
    amp({ type: 'Lead', gain: 70, bass: 60, middle: 65, treble: 25, presence: 30 }),
    reverb('ROOM', 20, 15)),
  preset('Killing in the Name', 'Songs',
    'Rage Against the Machine (Morello): Drop-D crunch. Switch FX on for the Whammy (+1 octave) solo.',
    amp({ type: 'Lead', gain: 60, bass: 55, middle: 60, treble: 55, presence: 50 }),
    fx('PITCH SHIFTER', { voice: '1VOICE', pitch1: 12, fine1: 0, level1: 100, direct_mix: 0 }),
    (v) => put(v, 'sw.fx_sw', 0), gate(25)),

  // ------------------------------------------------------------------ clean
  preset('Glassy Clean', 'Clean',
    'Sparkly studio clean: light compression, a little chorus and a hall. Great for arpeggios.',
    amp({ type: 'Clean', gain: 40, bass: 45, middle: 45, treble: 60, presence: 60 }),
    mod('CHORUS', { low_rate: 25, high_rate: 25, low_depth: 40, high_depth: 40, direct_mix: 80 }),
    fx('COMP', { type: 'BOSS COMP', sustain: 40, attack: 55, level: 50 }), reverb('HALL', 40, 28)),
  preset('Surf Reverb', 'Clean',
    'Dick Dale / Ventures: drippy spring reverb cranked up. Fast tremolo picking.',
    amp({ type: 'Clean', gain: 45, bass: 40, middle: 50, treble: 65, presence: 60 }),
    reverb('SPRING', 60, 60, { spring_color: 100 })),

  // ------------------------------------------------------------------ blues
  preset('Chicago Blues', 'Blues',
    'A small tweed amp on the edge of breakup. Clean when you play soft, gritty when you dig in.',
    amp({ type: 'Pushed', gain: 55, bass: 50, middle: 60, treble: 55, presence: 50 }),
    reverb('SPRING', 30, 25)),
  preset('Slow Blues Lead', 'Blues',
    'Singing, sustaining lead for slow blues: Blues Driver into a crunchy amp with a short delay.',
    amp({ type: 'Crunch', gain: 45, bass: 55, middle: 60, treble: 50, presence: 50 }),
    boost('BLUES DRIVE', { drive: 50, tone: 0, level: 55 }), delay('ANALOG', 320, 15, 20), reverb('HALL', 35, 22)),

  // ------------------------------------------------------------------ rock
  preset('Classic Rock Lead', 'Rock',
    '70s rock lead: a hot Marshall with a mid boost and a bit of delay for solos.',
    amp({ type: 'Lead', gain: 55, bass: 50, middle: 65, treble: 55, presence: 50 }),
    boost('MID BOOST', { drive: 40, tone: 0, level: 60 }), delay('ANALOG', 380, 20, 22), reverb('ROOM', 25, 18)),
  preset('80s Hair Metal Lead', 'Rock',
    'Big 80s solo tone: saturated amp, chorus, long delay and plate reverb.',
    amp({ type: 'Lead', gain: 75, bass: 55, middle: 55, treble: 65, presence: 60 }),
    mod('CHORUS', { low_rate: 35, high_rate: 35, low_depth: 45, high_depth: 45, direct_mix: 80 }),
    delay('DIGITAL', 420, 30, 35), reverb('PLATE', 45, 30), gate(20)),

  // ------------------------------------------------------------------ metal
  preset('Modern Metal Rhythm', 'Metal',
    'Tight modern high gain (djent-ish): boosted amp with a tight low end and a firm gate.',
    amp({ type: 'Brown', gain: 60, bass: 55, middle: 50, treble: 65, presence: 60, volume: 45 }),
    boost('T-SCREAM', { drive: 0, tone: 20, level: 80 }), gate(45, 30)),
  preset('Swedish Chainsaw', 'Metal',
    'Old-school Swedish death metal (Entombed): a BOSS HM-2 with everything maxed into a driven amp.',
    amp({ type: 'Brown', gain: 45, bass: 60, middle: 40, treble: 60, presence: 55, volume: 45 }),
    boost('HM-2', { drive: 80, tone: 20, level: 55 }), gate(40)),
  preset('Doom Fuzz', 'Metal',
    'Sleep / Electric Wizard style doom: thick fuzz, big bass, slow riffs in low tunings.',
    amp({ type: 'Brown', gain: 45, bass: 75, middle: 55, treble: 45, presence: 40, volume: 45 }),
    boost('MUFF FUZZ', { drive: 80, tone: -10, bottom: 20, level: 55 }), reverb('HALL', 40, 18)),

  // ------------------------------------------------------------------ punk & alt
  preset('Pop Punk', 'Punk & alt',
    'Green Day / Blink-182: saturated crunch with full lows and highs for power chords.',
    amp({ type: 'Lead', gain: 65, bass: 60, middle: 55, treble: 65, presence: 55 }),
    gate(25)),
  preset('90s Grunge', 'Punk & alt',
    'Big, slightly messy fuzz-distortion (Smashing Pumpkins / Mudhoney). Works on chords and leads.',
    amp({ type: 'Crunch', gain: 50, bass: 60, middle: 45, treble: 55, presence: 50 }),
    boost('MUFF FUZZ', { drive: 70, tone: 0, level: 55 }), reverb('ROOM', 20, 15)),
  preset('Shoegaze Wall', 'Punk & alt',
    'My Bloody Valentine style: fuzz into a huge modulated reverb. Strum and bend the whammy bar.',
    amp({ type: 'Crunch', gain: 40, bass: 55, middle: 50, treble: 55, presence: 50 }),
    boost('MUFF FUZZ', { drive: 60, tone: -5, level: 50 }),
    mod('VIBRATO', { rate: 30, depth: 35, level: 50 }), reverb('MODULATE', 90, 70)),

  // ------------------------------------------------------------------ funk & groove
  preset('Funk Rhythm', 'Funk & groove',
    'Nile Rodgers / James Brown chank: very clean, compressed, bright; single-coil middle or bridge.',
    amp({ type: 'Clean', gain: 35, bass: 40, middle: 55, treble: 65, presence: 60 }),
    mod('COMP', { type: 'BOSS COMP', sustain: 55, attack: 65, level: 50 }), reverb('ROOM', 15, 12)),
  preset('Auto-Wah Funk', 'Funk & groove',
    'Envelope-filter funk (Mu-Tron style): the harder you pick, the more it quacks.',
    amp({ type: 'Clean', gain: 40, bass: 45, middle: 55, treble: 55, presence: 50 }),
    mod('COMP', { type: 'BOSS COMP', sustain: 45, attack: 60, level: 50 }),
    fx('T.WAH', { mode: 'BPF', polarity: 'UP', sens: 60, freq: 30, peak: 55, effect_level: 60 })),
  preset('Reggae Skank', 'Funk & groove',
    'Off-beat reggae chops: thin, bright and tight with a short spring.',
    amp({ type: 'Clean', gain: 35, bass: 30, middle: 65, treble: 60, presence: 55 }),
    reverb('SPRING', 20, 22)),

  // ------------------------------------------------------------------ country
  preset('Chicken Pickin\'', 'Country',
    'Telecaster country: bright, compressed, with a single slapback repeat. Hybrid picking.',
    amp({ type: 'Clean', gain: 40, bass: 45, middle: 50, treble: 70, presence: 60 }),
    mod('COMP', { type: 'BOSS COMP', sustain: 50, attack: 65, level: 50 }),
    delay('ANALOG', 110, 0, 35), reverb('SPRING', 20, 18)),

  // ------------------------------------------------------------------ jazz
  preset('Jazz Box', 'Jazz',
    'Warm archtop jazz: neck pickup, treble down, round and dark. A little room.',
    amp({ type: 'Clean', gain: 40, bass: 60, middle: 50, treble: 30, presence: 20 }),
    reverb('ROOM', 25, 18)),

  // ------------------------------------------------------------------ ambient
  preset('Ambient Swells', 'Ambient',
    'Volume swells (Slow Gear) into long delays and a huge hall: pad-like soundscapes.',
    amp({ type: 'Clean', gain: 40, bass: 50, middle: 45, treble: 55, presence: 50 }),
    mod('SLOW GEAR', { sens: 50, rise_time: 60, level: 70 }),
    delay('DIGITAL', 600, 55, 45), reverb('HALL', 90, 50)),
  preset('Post-Rock Shimmer', 'Ambient',
    'Explosions in the Sky style: chimey clean with dotted delays and long, modulated reverb.',
    amp({ type: 'Pushed', gain: 35, bass: 45, middle: 50, treble: 60, presence: 55 }),
    delay('MODULATE', 450, 45, 45), reverb('MODULATE', 75, 45)),

  // ------------------------------------------------------------------ fun
  preset('Synth Lead', 'Fun',
    'Turns single notes into an analog-style saw synth. Play one note at a time.',
    amp({ type: 'Clean', gain: 40, bass: 50, middle: 50, treble: 50, presence: 50 }),
    fx('WAVE SYNTH', { wave: 'SAW', cutoff: 45, resonance: 50, filter_sens: 60, filter_decay: 55, filter_depth: 60, synth_level: 70, direct_mix: 0 }),
    delay('DIGITAL', 300, 25, 25)),
  preset('Robot Ring Mod', 'Fun',
    'Metallic, bell-like, out-of-tune robot sounds. Try slow bends.',
    amp({ type: 'Crunch', gain: 40, bass: 50, middle: 50, treble: 55, presence: 50 }),
    fx('RING MOD', { mode: 'INTELLIGENT', frequency: 60, effect_level: 100, direct_mix: 30 })),
  preset('Talking Guitar', 'Fun',
    'A talk-box-like vowel filter ("ah-ee") that follows your picking.',
    amp({ type: 'Crunch', gain: 50, bass: 50, middle: 60, treble: 50, presence: 50 }),
    fx('HUMANIZER', { mode: 'PICKING', vowel1: 'a', vowel2: 'i', sens: 60, level: 100 })),
  preset('Octave Bass', 'Fun',
    'Adds one and two octaves down under your playing: play bass lines on a guitar.',
    amp({ type: 'Clean', gain: 40, bass: 65, middle: 50, treble: 40, presence: 35 }),
    fx('HEAVY OCTAVE', { '1oct_level': 80, '2oct_level': 40, direct_mix: 40 })),
  preset('Reverse Dream', 'Fun',
    'Backwards delay: each note swells in after you play it. Slow, sparse lines.',
    amp({ type: 'Clean', gain: 40, bass: 50, middle: 50, treble: 55, presence: 50 }),
    delay('REVERSE', 500, 30, 70), reverb('HALL', 60, 35)),
]

if (problems.length) console.warn('preset problems:\n' + problems.join('\n'))
