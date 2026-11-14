<script lang="ts">
  import Choices from '../components/Choices.svelte'
  import Popover from '../components/Popover.svelte'
  import Stepper from '../components/Stepper.svelte'
  import { pressAt, type Point } from '../lib/press'
  import { format, isNumeric, param, writable } from '../lib/schema'
  import { store, type Guitar } from '../lib/store.svelte'

  /** Common adjustments; one row can drive several params (e.g. all three booster variations). */
  const PRESETS: { label: string; ids: string[] }[] = [
    { label: 'Gain', ids: ['amp.gain'] },
    { label: 'Volume', ids: ['amp.volume'] },
    { label: 'Bass', ids: ['amp.bass'] },
    { label: 'Middle', ids: ['amp.middle'] },
    { label: 'Treble', ids: ['amp.treble'] },
    { label: 'Presence', ids: ['amp.presence'] },
    { label: 'Booster drive', ids: ['booster1.drive', 'booster2.drive', 'booster3.drive'] },
    { label: 'Booster tone', ids: ['booster1.tone', 'booster2.tone', 'booster3.tone'] },
    { label: 'Noise gate threshold', ids: ['ns.threshold'] },
  ]
  const presetIds = new Set(PRESETS.flatMap((p) => p.ids))
  const PICKUPS: [Guitar['pickups'], string][] = [['single-coil', 'Single coil'], ['humbucker', 'Humbucker'], ['p90', 'P-90'], ['other', 'Other']]

  let selectedId = $state<string | null>(store.activeGuitarId ?? store.guitars[0]?.id ?? null)
  const g = $derived(store.guitars.find((x) => x.id === selectedId) ?? null)
  let addAt = $state<Point | null>(null)
  let filter = $state('')
  /** Open adjustment popover: the row (label + params it drives) and where it was pressed. */
  let editing = $state<{ label: string; ids: string[]; at: Point } | null>(null)
  let pickupAt = $state<Point | null>(null)

  const extraIds = $derived(g ? Object.keys(g.deltas).filter((id) => !presetIds.has(id)) : [])
  const candidates = $derived(
    writable.filter((p) => isNumeric(p) && !presetIds.has(p.id) && !(g && p.id in g.deltas))
      .filter((p) => { const q = filter.toLowerCase(); return !q || p.id.includes(q) || p.label.toLowerCase().includes(q) })
      .slice(0, 60),
  )

  const range = (id: string) => { const p = param(id); return Math.min(50, Math.ceil((p.max - p.min) / 2)) }
  function setDelta(ids: string[], v: number) {
    if (!g) return
    for (const id of ids) {
      if (v === 0) delete g.deltas[id]
      else g.deltas[id] = v
    }
    store.updateGuitar()
  }
  function add() {
    const n = store.addGuitar()
    selectedId = n.id
  }
  const pretty = (id: string) => { const p = param(id); return `${p.block.replace(/_/g, ' ').toLowerCase()} · ${p.label}` }
</script>

<div class="guitars">
  <aside class="list">
    <div class="row"><h2 class="grow">Guitars</h2><button onclick={add}>Add</button></div>
    <button class="item" class:sel={store.activeGuitarId === null} onclick={() => store.setActiveGuitar(null)}>
      <span class="radio" class:on={store.activeGuitarId === null}></span>
      <span class="grow">No adjustments</span>
    </button>
    {#each store.guitars as x (x.id)}
      <div class="item" class:open={x.id === selectedId}>
        <button class="ghost radio-btn" aria-label="Use {x.name}" onclick={() => store.setActiveGuitar(x.id)}>
          <span class="radio" class:on={store.activeGuitarId === x.id}></span>
        </button>
        <button class="ghost grow name" onclick={() => (selectedId = x.id)}>
          {x.name}<span class="dim small">{Object.keys(x.deltas).length || 'No'} adjustment{Object.keys(x.deltas).length === 1 ? '' : 's'}</span>
        </button>
      </div>
    {/each}
    <p class="dim small hint">The selected guitar's adjustments are added to every tone sent to the amp. Tones themselves don't change.</p>
  </aside>

  <section class="edit scroll">
    {#if g}
      <div class="row head">
        <input type="text" aria-label="Guitar name" value={g.name} oninput={(e) => { g.name = e.currentTarget.value; store.updateGuitar() }} />
        <button class={store.activeGuitarId === g.id ? '' : 'primary'} disabled={store.activeGuitarId === g.id} onclick={() => store.setActiveGuitar(g.id)}>
          {store.activeGuitarId === g.id ? 'In use' : 'Use this guitar'}
        </button>
        <button class="danger" onclick={() => store.deleteGuitar(g)}>Delete</button>
      </div>
      <button class="tile pick" onclick={(e) => (pickupAt = pressAt(e))}>
        <span class="dim small">Pickups</span><b>{PICKUPS.find(([k]) => k === g.pickups)?.[1]}</b><span class="dim">▾</span>
      </button>

      <h3 class="glabel">Adjustments <span class="dim">· current tone "{store.tone.name}" → what the amp gets</span></h3>
      <div class="tiles">
        {#each [...PRESETS, ...extraIds.map((id) => ({ label: pretty(id), ids: [id] }))] as row (row.label)}
          {@const d = g.deltas[row.ids[0]] ?? 0}
          {@const p = param(row.ids[0])}
          <button class="tile" class:set={d !== 0} onclick={(e) => (editing = { ...row, at: pressAt(e) })}>
            <span class="row"><span class="dim small grow tl">{row.label}</span><b class="dv" class:zero={d === 0}>{d > 0 ? '+' : ''}{d}</b></span>
            <span class="prev dim">{format(p, store.tone.params[p.id])} → <b class:changed={d !== 0}>{format(p, Math.min(p.max, Math.max(p.min, Number(store.tone.params[p.id]) + d)))}</b></span>
          </button>
        {/each}
        <button class="tile add" onclick={(e) => (addAt = pressAt(e))}>+ Add another parameter</button>
      </div>
    {:else}
      <div class="empty">
        <p class="dim">Add a guitar to store how its sound differs, e.g. a Strat with single coils might want +12 gain and −6 treble compared to the tones you made on a humbucker guitar.</p>
        <button class="primary" onclick={add}>Add a guitar</button>
      </div>
    {/if}
  </section>
</div>

{#if editing && g}
  {@const row = editing}
  {@const d = g.deltas[row.ids[0]] ?? 0}
  {@const r = range(row.ids[0])}
  {@const p = param(row.ids[0])}
  <Popover at={row.at} onclose={() => (editing = null)} width={420}>
    <div class="row"><b class="grow">{row.label}</b><b class="big" class:zero={d === 0}>{d > 0 ? '+' : ''}{d}</b></div>
    <Stepper value={d} min={-r} max={r} label="{row.label} adjustment" centered onchange={(v) => setDelta(row.ids, v)} />
    <div class="row">
      <span class="dim small grow">"{store.tone.name}": {format(p, store.tone.params[p.id])} → {format(p, Math.min(p.max, Math.max(p.min, Number(store.tone.params[p.id]) + d)))}</span>
      <button class="ghost" disabled={d === 0} onclick={() => setDelta(row.ids, 0)}>Reset to 0</button>
    </div>
  </Popover>
{/if}

{#if pickupAt && g}
  <Popover at={pickupAt} onclose={() => (pickupAt = null)} width={340}>
    <b>Pickups</b>
    <Choices options={PICKUPS.map(([, l]) => l)} value={PICKUPS.findIndex(([k]) => k === g.pickups)}
      onpick={(i) => { g.pickups = PICKUPS[i][0]; store.updateGuitar() }} />
  </Popover>
{/if}

{#if addAt && g}
  <Popover at={addAt} onclose={() => { addAt = null; filter = '' }} width={560}>
    <b>Add a parameter</b>
    <input type="search" placeholder="Search, e.g. reverb level" bind:value={filter} />
    <div class="cands">
      {#each candidates as p (p.id)}
        <button onclick={(e) => { setDelta([p.id], 1); addAt = null; filter = ''; editing = { label: pretty(p.id), ids: [p.id], at: pressAt(e) } }}>{pretty(p.id)}</button>
      {/each}
    </div>
  </Popover>
{/if}

<style>
  .guitars { display: grid; grid-template-columns: 300px 1fr; gap: 12px; height: 100%; padding: 12px 16px 16px; }
  .list { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 12px; display: flex; flex-direction: column; gap: 8px; overflow-y: auto; }
  .item { display: flex; align-items: center; gap: 4px; border: 1px solid var(--line); border-radius: var(--r); background: var(--panel2); padding: 0 6px; min-height: 56px; text-align: left; }
  .item.open { border-color: var(--accent); }
  .name { display: flex; flex-direction: column; align-items: flex-start; justify-content: center; text-align: left; padding: 6px 4px; }
  .radio-btn { width: var(--tap); padding: 0; display: grid; place-items: center; }
  .radio { width: 22px; height: 22px; border-radius: 50%; border: 2px solid var(--dim); display: inline-block; flex: none; }
  .radio.on { border-color: var(--accent); background: radial-gradient(var(--accent) 45%, transparent 50%); }
  button.item { gap: 12px; padding: 0 16px; }
  .small { font-size: 13px; }
  .hint { margin-top: auto; }
  .edit { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 14px 16px; display: flex; flex-direction: column; gap: 12px; }
  .head input { flex: 1; font-size: 20px; font-weight: 600; }
  .glabel { font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--dim); margin-top: 6px; }
  .glabel .dim { text-transform: none; letter-spacing: 0; }
  .dv { text-align: right; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--accent); }
  .dv.zero { color: var(--dim); font-weight: 400; }
  .prev .changed { color: var(--text); }
  .empty { margin: auto; max-width: 460px; text-align: center; display: flex; flex-direction: column; gap: 16px; align-items: center; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; }
  .tile { display: flex; flex-direction: column; align-items: stretch; justify-content: center; gap: 4px; min-height: 64px; padding: 6px 12px; text-align: left; }
  .tile.set { border-color: var(--accent-dim); }
  .tile.add { align-items: center; border-style: dashed; color: var(--dim); }
  .tile.pick { flex-direction: row; align-items: center; gap: 10px; align-self: flex-start; min-width: 260px; }
  .tile.pick b { flex: 1; }
  .tl { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .prev { font-size: 14px; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .big { font-size: 26px; color: var(--accent); font-variant-numeric: tabular-nums; }
  .big.zero { color: var(--dim); }
  .cands { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; align-content: start; max-height: 50vh; overflow-y: auto; }
  .cands button { text-align: left; white-space: normal; }
</style>
