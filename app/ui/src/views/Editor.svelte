<script lang="ts">
  import { tick } from 'svelte'
  import Choices from '../components/Choices.svelte'
  import ParamControl from '../components/ParamControl.svelte'
  import Popover from '../components/Popover.svelte'
  import Toggle from '../components/Toggle.svelte'
  import { pressAt, type Point } from '../lib/press'
  import { COLOR_CSS, format, layout, param, variationIndex, visibleGroups } from '../lib/schema'
  import { CATS, sections } from '../lib/sections'
  import { store } from '../lib/store.svelte'

  const values = $derived(store.tone.params)
  const block = $derived(layout.find((b) => b.key === store.block) ?? layout[0])
  const groups = $derived(visibleGroups(block, values))
  const vi = $derived(variationIndex(block, values))
  const deltas = $derived(store.activeGuitar?.deltas ?? {})

  // For MOD/FX the first group is the effect type; show it as a big picker in the header.
  const typeParam = $derived(groups[0]?.label === 'Type' ? param(groups[0].params[0]) : null)
  const bodyGroups = $derived(typeParam ? groups.slice(1) : groups)
  let typeAt = $state<Point | null>(null)

  // Full-size tiles when they fit; a block with too many controls to fit (e.g. Solo) switches
  // to compact tiles rather than making you scroll.
  let bodyEl: HTMLDivElement | undefined = $state()
  let compact = $state(false)
  $effect(() => {
    void bodyGroups
    compact = false
    tick().then(() => {
      if (bodyEl && bodyEl.scrollHeight > bodyEl.clientHeight + 2) compact = true
    })
  })

  const isOn = (key: string) => {
    const b = layout.find((x) => x.key === key)!
    return b.switch ? !!values[b.switch] : true
  }
  /** Short subtitle for a chain tile: the selected type, if the block has one. */
  function subtitle(key: string) {
    const b = layout.find((x) => x.key === key)!
    const g = visibleGroups(b, values)
    const t = g[0]?.params.find((id) => id.endsWith('.type'))
    return t ? format(param(t), values[t]) : ''
  }
</script>

<div class="editor">
  <nav class="chain scroll-x" aria-label="Signal chain">
    {#each layout as b (b.key)}
      <div class="tile" class:sel={b.key === store.block} class:off={!isOn(b.key)}>
        {#if b.switch}
          <button class="led-btn" role="switch" aria-checked={isOn(b.key)} aria-label="{b.label} on/off"
            onclick={() => store.setParam(b.switch!, isOn(b.key) ? 0 : 1)}><span class="led" class:lit={isOn(b.key)}></span></button>
        {/if}
        <button class="tile-body" onclick={() => (store.block = b.key)}>
          <span class="row tile-top">
            <span class="name">{b.label}</span>
            {#if b.color}<span class="pip" style="background:{COLOR_CSS[variationIndex(b, values)]}"></span>{/if}
          </span>
          <span class="sub">{subtitle(b.key)}</span>
        </button>
      </div>
    {/each}
  </nav>

  <section class="panel">
    <header class="row phead">
      <h2>{block.label}</h2>
      {#if block.switch}
        <Toggle on={!!values[block.switch]} label="{block.label} on" onchange={(v) => store.setParam(block.switch!, v ? 1 : 0)} />
      {/if}
      {#if block.color}
        <div class="colors" role="radiogroup" aria-label="Variation">
          {#each ['Green', 'Red', 'Yellow'] as c, i}
            <button role="radio" aria-checked={vi === i} class:sel={vi === i} style="--c:{COLOR_CSS[i]}"
              onclick={() => store.setParam(block.color!, i)}>{c}</button>
          {/each}
        </div>
      {/if}
      {#if typeParam}
        <button class="type" onclick={(e) => (typeAt = pressAt(e))}>
          <span class="dim">Type</span> <b>{format(typeParam, values[typeParam.id])}</b> <span class="dim">▾</span>
        </button>
        {#if typeAt}
          <Popover at={typeAt} onclose={() => (typeAt = null)} width={560}>
            <b>{block.label} type</b>
            <Choices options={typeParam.options!} value={Number(values[typeParam.id]) - typeParam.min}
              onpick={(i) => store.setParam(typeParam.id, typeParam.min + i)} />
          </Popover>
        {/if}
      {/if}
    </header>

    <div class="body scroll" class:compact bind:this={bodyEl}>
      <!-- Sections from all groups share rows; with several groups each header names its group. -->
      <div class="secs">
        {#each bodyGroups as g (g.label)}
          {#each sections(g.params) as sec (sec.cat)}
            <section class="sec" style="--c:{CATS[sec.cat].color}; flex-grow:{sec.tiles.length}; flex-basis:{sec.tiles.length * 170}px">
              <h4><span class="dot"></span>{#if bodyGroups.length > 1 || g.label !== block.label}<span class="gname">{g.label}</span>{/if}{CATS[sec.cat].label}</h4>
              <div class="grid">
                {#each sec.tiles as t (t.id)}
                  {@const sw = t.sw}
                  <ParamControl p={param(t.id)} value={values[t.id]} onchange={(v) => store.setParam(t.id, v)}
                    effective={deltas[t.id] ? store.effective(t.id) : undefined}
                    toggle={sw ? { p: param(sw), value: values[sw], onchange: (v) => store.setParam(sw, v) } : undefined} />
                {/each}
              </div>
            </section>
          {/each}
        {/each}
      </div>
    </div>
  </section>
</div>

<style>
  .editor { display: flex; flex-direction: column; height: 100%; gap: 12px; padding: 12px 16px 16px; }
  .chain { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; flex: none; scrollbar-width: thin; }
  .tile { flex: none; width: 140px; height: 68px; display: flex; border: 1px solid var(--line); border-radius: var(--r); background: var(--panel2); overflow: hidden; }
  .tile.sel { border-color: var(--accent); background: #2c2518; }
  .led-btn { width: 34px; min-height: 0; padding: 0; display: grid; place-items: center; border: 0; border-right: 1px solid var(--line); border-radius: 0; background: #0002; flex: none; }
  .tile-body { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 4px; padding: 6px 10px; text-align: left; border: 0; border-radius: 0; background: transparent; }
  .tile.off .name { color: var(--dim); }
  .tile-top { gap: 7px; width: 100%; }
  .name { font-weight: 600; flex: 1; overflow: hidden; text-overflow: ellipsis; }
  .sub { font-size: 12px; color: var(--dim); max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
  .led { width: 12px; height: 12px; border-radius: 50%; background: #3a3f48; flex: none; }
  .led.lit { background: var(--ok); box-shadow: 0 0 6px var(--ok); }
  .pip { width: 4px; height: 18px; border-radius: 2px; flex: none; }

  .panel { flex: 1; min-height: 0; display: flex; flex-direction: column; background: var(--panel); border: 1px solid var(--line); border-radius: 14px; }
  .phead { padding: 12px 16px; border-bottom: 1px solid var(--line); flex-wrap: wrap; gap: 12px; }
  .phead h2 { min-width: 110px; }
  .colors { display: flex; gap: 4px; }
  .colors button { min-width: 84px; border-left: 6px solid var(--c); }
  .colors .sel { background: #2c2518; border-color: var(--accent); border-left-color: var(--c); font-weight: 600; }
  .type { display: flex; gap: 8px; align-items: center; min-width: 220px; justify-content: space-between; }
  .body { flex: 1; min-height: 0; padding: 12px 16px 20px; }
  /* Sections share rows, each sized by how many controls it has. */
  .secs { display: flex; flex-wrap: wrap; gap: 12px; }
  .sec { min-width: 180px; background: color-mix(in srgb, var(--c) 6%, var(--panel)); border: 1px solid color-mix(in srgb, var(--c) 30%, var(--line));
    border-top: 3px solid var(--c); border-radius: 12px; padding: 8px 10px 10px; }
  .sec h4 { margin: 0 0 8px; font-size: 13px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--c); display: flex; align-items: center; gap: 6px; }
  .gname { color: var(--text); margin-right: 2px; }
  .gname::after { content: ' ·'; color: var(--dim); }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--c); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
  .compact .secs { gap: 8px; }
  .compact .sec { padding: 6px 8px 8px; }
  .compact .sec h4 { margin-bottom: 6px; }
  .compact :global(.tile) { min-height: 62px; }
  .compact :global(.tile .open), .compact :global(.tile.sw) { padding: 4px 12px; gap: 2px; }
  .compact :global(.tile .val) { font-size: 19px; }
  .compact :global(.tile svg) { width: 34px; height: 34px; }
</style>
