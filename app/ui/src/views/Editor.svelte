<script lang="ts">
  import ParamControl from '../components/ParamControl.svelte'
  import Picker from '../components/Picker.svelte'
  import Toggle from '../components/Toggle.svelte'
  import { COLOR_CSS, format, layout, param, variationIndex, visibleGroups } from '../lib/schema'
  import { store } from '../lib/store.svelte'

  const values = $derived(store.tone.params)
  const block = $derived(layout.find((b) => b.key === store.block) ?? layout[0])
  const groups = $derived(visibleGroups(block, values))
  const vi = $derived(variationIndex(block, values))
  const deltas = $derived(store.activeGuitar?.deltas ?? {})

  // For MOD/FX the first group is the effect type; show it as a big picker in the header.
  const typeParam = $derived(groups[0]?.label === 'Type' ? param(groups[0].params[0]) : null)
  const bodyGroups = $derived(typeParam ? groups.slice(1) : groups)
  let pickingType = $state(false)

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
      <button class="tile" class:sel={b.key === store.block} class:off={!isOn(b.key)} onclick={() => (store.block = b.key)}>
        <span class="row tile-top">
          {#if b.switch}<span class="led" class:lit={isOn(b.key)}></span>{/if}
          <span class="name">{b.label}</span>
          {#if b.color}<span class="pip" style="background:{COLOR_CSS[variationIndex(b, values)]}"></span>{/if}
        </span>
        <span class="sub">{subtitle(b.key)}</span>
      </button>
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
        <button class="type" onclick={() => (pickingType = true)}>
          <span class="dim">Type</span> <b>{format(typeParam, values[typeParam.id])}</b> <span class="dim">▾</span>
        </button>
        {#if pickingType}
          <Picker title="{block.label} type" options={typeParam.options!} value={Number(values[typeParam.id])}
            onpick={(i) => { store.setParam(typeParam.id, i); pickingType = false }} onclose={() => (pickingType = false)} />
        {/if}
      {/if}
    </header>

    <div class="body scroll">
      {#each bodyGroups as g (g.label)}
        {#if bodyGroups.length > 1 || g.label !== block.label}<h3 class="glabel">{g.label}</h3>{/if}
        <div class="grid">
          {#each g.params as id (id)}
            {@const p = param(id)}
            <ParamControl {p} value={values[id]} onchange={(v) => store.setParam(id, v)}
              effective={deltas[id] ? store.effective(id) : undefined} />
          {/each}
        </div>
      {/each}
    </div>
  </section>
</div>

<style>
  .editor { display: flex; flex-direction: column; height: 100%; gap: 12px; padding: 12px 16px 16px; }
  .chain { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; flex: none; scrollbar-width: thin; }
  .tile { flex: none; width: 128px; height: 68px; display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 4px; padding: 6px 10px; text-align: left; }
  .tile.sel { border-color: var(--accent); background: #2c2518; }
  .tile.off .name { color: var(--dim); }
  .tile-top { gap: 7px; width: 100%; }
  .name { font-weight: 600; flex: 1; overflow: hidden; text-overflow: ellipsis; }
  .sub { font-size: 12px; color: var(--dim); max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
  .led { width: 10px; height: 10px; border-radius: 50%; background: #3a3f48; flex: none; }
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
  .glabel { font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--dim); margin: 14px 0 8px; }
  .glabel:first-child { margin-top: 0; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 10px; }
</style>
