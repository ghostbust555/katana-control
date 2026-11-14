<script lang="ts">
  // One parameter as a compact tile: tap it to open its control in a popover at the press
  // point (slider with −/+ for numbers, option grid for choices, a text box for the name).
  // On/off switches toggle in place. `toggle` pairs an on/off switch with this param
  // (e.g. Solo On + Solo Level): the switch toggles in place, the rest of the tile opens the
  // control while it's on.
  import { isNumeric, format, type Param, type Value } from '../lib/schema'
  import { pressAt, type Point } from '../lib/press'
  import Choices from './Choices.svelte'
  import Knob from './Knob.svelte'
  import Popover from './Popover.svelte'
  import Stepper from './Stepper.svelte'

  let { p, value, onchange, effective, toggle }: {
    p: Param; value: Value; onchange: (v: Value) => void; effective?: Value
    toggle?: { p: Param; value: Value; onchange: (v: Value) => void }
  } = $props()

  let at = $state<Point | null>(null)
  // A number tile wide enough for the popover's slider shows the slider in place.
  let tw = $state(0)
  const inline = $derived(isNumeric(p) && tw >= 440)
  const num = $derived(typeof value === 'number' ? value : Number(p.init))
  const frac = $derived((num - p.min) / Math.max(1, p.max - p.min))
  const off = $derived(!!toggle && !toggle.value)
  const changed = $derived(effective !== undefined && effective !== value)
  /** Displayed value split into number and unit, so the unit can be smaller. */
  const shown = $derived.by(() => {
    const t = p.enc === 'ascii' ? String(value).trimEnd() : format(p, value)
    const m = isNumeric(p) && p.unit && t.endsWith(' ' + p.unit) ? t.slice(0, -p.unit.length - 1) : null
    return m === null ? { n: t, u: '' } : { n: m, u: p.unit! }
  })
</script>

{#if p.switch}
  <button class="tile sw" class:on={!!num} role="switch" aria-checked={!!num} onclick={() => onchange(num ? 0 : 1)}>
    <span class="label">{p.label}</span>
    <span class="row"><b class="val">{num ? 'On' : 'Off'}</b><span class="lever"></span></span>
  </button>
{:else}
  <div class="tile" class:paired={!!toggle} class:off class:choice={!isNumeric(p)} bind:clientWidth={tw}>
    {#if toggle}
      <button class="pair-sw" class:on={!!toggle.value} role="switch" aria-checked={!!toggle.value} aria-label={toggle.p.label}
        onclick={() => toggle.onchange(toggle.value ? 0 : 1)}><span class="lever"></span></button>
    {/if}
    {#if inline}
      <div class="inl" inert={off}>
        <button class="inl-head" title="Tap for reset and range" onclick={(e) => (at = pressAt(e))}>
          <span class="label grow">{p.label}</span>
          {#if changed}<span class="eff" title="Sent to the amp with the active guitar">→ {format(p, effective!)}</span>{/if}
          <b class="val">{shown.n}{#if shown.u}<small>{shown.u}</small>{/if}</b>
        </button>
        <Stepper inline value={num} min={p.min} max={p.max} label={p.label} onchange={(v) => onchange(v)} />
      </div>
    {:else}
    <button class="open" disabled={off} onclick={(e) => (at = pressAt(e))}>
      <span class="label">{p.label}</span>
      <span class="row">
        <b class="val">{shown.n}{#if shown.u}<small>{shown.u}</small>{/if}</b>
        {#if changed}<span class="eff" title="Sent to the amp with the active guitar">→ {format(p, effective!)}</span>{/if}
        <span class="grow"></span>
        {#if isNumeric(p)}<Knob {frac} size={44} />{:else if p.options}<span class="caret">▾</span>{/if}
      </span>
    </button>
    {/if}
  </div>
{/if}

{#if at}
  <Popover {at} onclose={() => (at = null)} width={p.options && p.options.length > 8 ? 640 : 540}>
    <div class="row head">
      <span class="grow ptitle">{p.label}</span>
      {#if !p.options && p.enc !== 'ascii'}<b class="big">{format(p, value)}</b>{/if}
    </div>
    {#if changed}<span class="eff">The amp gets {format(p, effective!)} with the active guitar</span>{/if}
    {#if p.enc === 'ascii'}
      <!-- svelte-ignore a11y_autofocus -->
      <input type="text" maxlength={p.len} value={String(value).trimEnd()} autofocus oninput={(e) => onchange(e.currentTarget.value)} />
    {:else if p.options}
      <Choices options={p.options} value={num - p.min} onpick={(i) => onchange(p.min + i)} />
    {:else}
      <Stepper value={num} min={p.min} max={p.max} label={p.label} onchange={(v) => onchange(v)} />
      <div class="row foot">
        <span class="dim small">{format(p, p.min)} – {format(p, p.max)}</span>
        <span class="grow"></span>
        <button class="ghost" disabled={num === Number(p.init)} onclick={() => onchange(p.init)}>Reset to {format(p, p.init)}</button>
      </div>
    {/if}
  </Popover>
{/if}

<style>
  /* --c is the section colour (set by the editor); falls back to the accent. */
  .tile { display: flex; align-items: stretch; min-width: 0; min-height: 84px; background: var(--panel2); border: 1px solid var(--line); border-radius: 12px; }
  .tile > .open, .tile.sw { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; align-items: stretch; gap: 4px; padding: 8px 14px; text-align: left; border: 0; border-radius: 12px; background: transparent; }
  .tile.sw { background: var(--panel2); border: 1px solid var(--line); }
  /* Choices read as dropdowns: darker well, value first, caret. */
  .tile.choice { background: var(--bg); border-style: dashed; border-color: #3d434d; }
  .label { color: var(--dim); font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row { gap: 8px; min-width: 0; }
  .val { font-size: 22px; font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .choice .val { font-size: 18px; }
  .val small { font-size: 13px; font-weight: 600; color: var(--dim); margin-left: 3px; }
  .eff { font-size: 14px; color: var(--accent); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .caret { font-size: 18px; color: var(--c, var(--dim)); }
  .off .open, .off .inl { opacity: 0.45; }
  .inl { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; padding: 4px 12px 6px; }
  .inl-head { display: flex; align-items: baseline; gap: 10px; min-height: 0; padding: 4px 0 0; border: 0; background: transparent; text-align: left; }
  .inl-head .val { color: var(--c, var(--accent)); }
  /* on/off lever, as in Toggle */
  .lever { width: 48px; height: 28px; border-radius: 14px; background: var(--line); position: relative; flex: none; margin-left: auto; transition: background 0.15s; }
  .lever::after { content: ''; position: absolute; top: 3px; left: 3px; width: 22px; height: 22px; border-radius: 50%; background: var(--dim); transition: transform 0.15s, background 0.15s; }
  .on .lever { background: var(--accent-dim); }
  .on .lever::after { transform: translateX(20px); background: var(--accent); }
  .sw.on .val { color: var(--accent); }
  .pair-sw { width: 72px; flex: none; padding: 0; display: grid; place-items: center; border: 0; border-right: 1px solid var(--line); border-radius: 12px 0 0 12px; background: transparent; }
  .pair-sw .lever { margin: 0; }
  .head { gap: 12px; }
  .ptitle { font-weight: 600; font-size: 19px; }
  .big { font-size: 30px; font-variant-numeric: tabular-nums; color: var(--accent); }
  .foot { gap: 8px; }
  .small { font-size: 14px; }
</style>
