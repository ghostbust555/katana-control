<script lang="ts">
  // One parameter card: slider (+/- for fine steps), toggle, segmented choice, picker or text.
  // Double-click / double-tap the label to reset to the default.
  import { format, type Param, type Value } from '../lib/schema'
  import Picker from './Picker.svelte'
  import Toggle from './Toggle.svelte'

  let { p, value, onchange, effective }: {
    p: Param; value: Value; onchange: (v: Value) => void; effective?: Value
  } = $props()

  let picking = $state(false)
  const num = $derived(typeof value === 'number' ? value : Number(p.init))
  const fill = $derived(((num - p.min) / Math.max(1, p.max - p.min)) * 100)
  const step = $derived(p.max - p.min > 400 ? 10 : 1)
  const set = (v: number) => onchange(clamp(v))
  const reset = () => onchange(p.init)

  // Tap +/- for one step; hold to repeat, speeding up after a moment.
  const clamp = (v: number) => Math.min(p.max, Math.max(p.min, Math.round(v)))
  let timer = 0
  function hold(dir: number) {
    let v = clamp(num + dir)
    onchange(v)
    let n = 0
    timer = setTimeout(function rep() {
      n++
      v = clamp(v + dir * (n > 10 ? step * 5 : step))
      onchange(v)
      timer = setTimeout(rep, 60) as unknown as number
    }, 400) as unknown as number
  }
  const release = () => clearTimeout(timer)
</script>

<div class="card" class:wide={p.enc === 'ascii' || (p.options && p.options.length <= 4)}>
  <div class="top row">
    <span class="label grow" role="button" tabindex="-1" ondblclick={reset} title="Double-click to reset">{p.label}</span>
    {#if !p.switch && !p.options && p.enc !== 'ascii'}
      <span class="val">{format(p, value)}</span>
    {/if}
    {#if effective !== undefined && effective !== value}
      <span class="eff" title="Sent to the amp with the active guitar">→ {format(p, effective)}</span>
    {/if}
  </div>

  {#if p.enc === 'ascii'}
    <input type="text" maxlength={p.len} value={String(value).trimEnd()} oninput={(e) => onchange(e.currentTarget.value)} />
  {:else if p.switch}
    <Toggle on={!!num} label={p.label} onchange={(v) => onchange(v ? 1 : 0)} />
  {:else if p.options && p.options.length <= 4}
    <div class="seg" role="radiogroup" aria-label={p.label}>
      {#each p.options as o, i}
        <button role="radio" aria-checked={num - p.min === i} class:sel={num - p.min === i} onclick={() => onchange(p.min + i)}>{o}</button>
      {/each}
    </div>
  {:else if p.options}
    <button class="pick" onclick={() => (picking = true)}>{format(p, value)} <span class="dim">▾</span></button>
    {#if picking}
      <Picker title={p.label} options={p.options} value={num - p.min}
        onpick={(i) => { onchange(p.min + i); picking = false }} onclose={() => (picking = false)} />
    {/if}
  {:else}
    <div class="row slider">
      <button class="step" aria-label="Decrease {p.label}" onpointerdown={() => hold(-1)} onpointerup={release} onpointerleave={release}>−</button>
      <input type="range" min={p.min} max={p.max} step="1" value={num} style="--fill:{fill}%"
        aria-label={p.label} oninput={(e) => set(+e.currentTarget.value)} />
      <button class="step" aria-label="Increase {p.label}" onpointerdown={() => hold(1)} onpointerup={release} onpointerleave={release}>+</button>
    </div>
  {/if}
</div>

<style>
  .card { background: var(--panel2); border: 1px solid var(--line); border-radius: var(--r); padding: 10px 12px 8px; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  .card.wide { grid-column: span 2; }
  .top { gap: 8px; min-height: 22px; }
  .label { color: var(--dim); font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: default; }
  .val { font-weight: 600; font-variant-numeric: tabular-nums; }
  .eff { font-size: 13px; color: var(--accent); font-variant-numeric: tabular-nums; }
  .slider { gap: 6px; }
  .step { width: var(--tap); padding: 0; font-size: 22px; flex: none; touch-action: none; }
  .seg { display: flex; gap: 4px; flex-wrap: wrap; }
  .seg button { flex: 1; padding: 0 8px; }
  .seg .sel { background: var(--accent); border-color: var(--accent); color: #1a1206; font-weight: 600; }
  .pick { display: flex; align-items: center; justify-content: space-between; font-weight: 600; }
  @media (max-width: 700px) { .card.wide { grid-column: span 1; } }
</style>
