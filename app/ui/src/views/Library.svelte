<script lang="ts">
  import Popover from '../components/Popover.svelte'
  import { pressAt, type Point } from '../lib/press'
  import { PRESET_CATEGORIES, presets } from '../lib/presets'
  import { channels, chStyle, format, layout, param } from '../lib/schema'
  import { store, type Tone } from '../lib/store.svelte'

  let query = $state('')
  /** Which list is shown: your saved tones, or the read-only defaults that ship with the app. */
  let source = $state<'mine' | 'defaults'>('mine')
  let category = $state<string | null>(null)
  let fileInput: HTMLInputElement | undefined = $state()
  /** Open action popover: for a tone card, or for a channel slot. */
  let toneMenu = $state<{ t: Tone; at: Point } | null>(null)
  let slotMenu = $state<{ key: string; at: Point } | null>(null)

  const shown = $derived.by(() => {
    const q = query.trim().toLowerCase()
    const list = source === 'mine' ? store.tones : presets.filter((t) => !category || t.tags.includes(category))
    return list.filter((t) => !q || t.name.toLowerCase().includes(q) || t.tags.some((x) => x.toLowerCase().includes(q)) || t.notes.toLowerCase().includes(q))
  })
  const toneOf = (id: string | null) => store.findTone(id)
  /** "AC/DC" from a default tone's notes ("AC/DC: Gibson SG into ..."), else its category. */
  const byline = (t: Tone) => (t.tags[0] === 'Songs' && t.notes.includes(':') ? t.notes.slice(0, t.notes.indexOf(':')) : t.tags[0])
  const ampType = (t: Tone) => format(param('amp.type'), t.params['amp.type'])
  /** Blocks switched on in this tone, for the card's chips. */
  const activeBlocks = (t: Tone) =>
    layout.filter((b) => b.switch && ['booster', 'mod', 'fx', 'delay', 'delay2', 'reverb'].includes(b.key) && t.params[b.switch]).map((b) => b.label)
  const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  const ampReady = $derived(store.amp.connected && !store.amp.busy)

  function addTag(t: Tone) {
    toneMenu = null
    store.ask = {
      title: `Add a tag to "${t.name}"`, value: '', okLabel: 'Add tag',
      onsubmit: (v) => {
        const tag = v.trim()
        if (tag && !t.tags.includes(tag)) {
          t.tags.push(tag)
          store.updateTone(t)
        }
      },
    }
  }
  function rename(t: Tone) {
    toneMenu = null
    store.ask = { title: 'Rename tone', value: t.name, okLabel: 'Rename', onsubmit: (v) => v.trim() && store.renameTone(t, v.trim()) }
  }
  function open(t: Tone) {
    toneMenu = null
    slotMenu = null
    store.open(t)
  }
</script>

<div class="lib">
  <section class="channels">
    <div class="row chead">
      <h2 class="grow">Amp channels</h2>
      <span class="dim">{store.activeGuitar ? `Written for ${store.activeGuitar.name}` : 'No guitar adjustments'}</span>
      <button class="primary" disabled={!ampReady || !Object.values(store.assignments).some(Boolean)}
        onclick={() => store.writeAllChannels()}>Write all to amp</button>
    </div>
    <div class="slots">
      {#each channels as c (c.key)}
        {@const t = toneOf(store.assignments[c.key])}
        <button class="slot" class:empty={!t} class:onamp={store.channel === c.patch} style={chStyle(c.key)} onclick={(e) => (slotMenu = { key: c.key, at: pressAt(e) })}>
          <span class="ch">{c.key}</span>
          <span class="grow tn">{t?.name ?? 'Empty'}</span>
          <span class="dim">⋯</span>
        </button>
      {/each}
    </div>
  </section>

  <div class="row tools">
    <div class="seg" role="tablist">
      <button role="tab" class:on={source === 'mine'} aria-selected={source === 'mine'} onclick={() => (source = 'mine')}>Your tones <span class="n">{store.tones.length}</span></button>
      <button role="tab" class:on={source === 'defaults'} aria-selected={source === 'defaults'} onclick={() => (source = 'defaults')}>Default tones <span class="n">{presets.length}</span></button>
    </div>
    <input type="search" placeholder="Search tones or tags" bind:value={query} />
    {#if source === 'mine'}<button onclick={() => { store.newTone(); store.view = 'editor' }}>New tone</button>{/if}
    <button onclick={() => fileInput?.click()} title="Import tones from BOSS Tone Studio / Tone Exchange liveset files">Import .tsl…</button>
    <input bind:this={fileInput} type="file" accept=".tsl" multiple hidden
      onchange={(e) => { const fs = [...(e.currentTarget.files ?? [])]; e.currentTarget.value = ''; if (fs.length) store.importTsl(fs) }} />
  </div>

  {#if source === 'defaults'}
    <div class="cats">
      <button class:on={!category} onclick={() => (category = null)}>All</button>
      {#each PRESET_CATEGORIES as c}<button class:on={category === c} onclick={() => (category = category === c ? null : c)}>{c}</button>{/each}
    </div>
  {/if}

  <div class="tones scroll">
    {#if shown.length === 0}
      <p class="dim empty-msg">{source === 'defaults' || store.tones.length ? 'No tones match.' : 'No saved tones yet. Make one in the Editor and press Save, or copy a default tone.'}</p>
    {/if}
    <div class="grid">
      {#each shown as t (t.id)}
        {@const on = store.channelsOf(t.id)}
        <button class="tone" class:builtin={t.builtin} class:current={t.id === store.tone.id} class:sel={toneMenu?.t.id === t.id}
          onclick={(e) => (toneMenu = { t, at: pressAt(e) })}>
          <span class="row top">
            <b class="grow tname">{t.name}</b>
            {#each on as k}<span class="chbadge" style={chStyle(k)}>{k}</span>{/each}
          </span>
          {#if t.builtin}
            <span class="dim small by">{byline(t)} · {ampType(t)}</span>
          {:else}
            <span class="dim small">{ampType(t)} · {when(t.modified)}</span>
          {/if}
          <span class="chips">
            {#each activeBlocks(t) as b}<span class="chip">{b}</span>{/each}
            {#if !t.builtin}{#each t.tags as tag}<span class="chip tag">#{tag}</span>{/each}{/if}
          </span>
        </button>
      {/each}
    </div>
  </div>
</div>

{#if toneMenu}
  {@const t = toneMenu.t}
  {@const on = store.channelsOf(t.id)}
  <Popover at={toneMenu.at} onclose={() => (toneMenu = null)} width={600}>
    <b class="mtitle">{t.name}</b>
    {#if t.builtin}<p class="notes">{t.notes}</p>{/if}
    <div class="acts">
      <button class="primary" onclick={() => open(t)}>Open in editor</button>
      <button disabled={!ampReady} onclick={() => store.audition(t)}>▶ Play on amp</button>
    </div>
    <span class="dim">Channel</span>
    <div class="chans">
      {#each channels as c (c.key)}
        <button class="chbtn" class:sel={on.includes(c.key)} style={chStyle(c.key)} aria-pressed={on.includes(c.key)}
          title={on.includes(c.key) ? `Remove from ${c.key}` : `Assign to ${c.key} (was ${toneOf(store.assignments[c.key])?.name ?? 'empty'})`}
          onclick={() => store.assign(c.key, on.includes(c.key) ? null : t.id)}>{c.key}</button>
      {/each}
    </div>
    {#if t.builtin}
      <div class="acts one">
        <button onclick={() => { store.duplicate(t); toneMenu = null; store.toast(`Copied "${t.name}" to your tones`) }}>Copy to your tones</button>
      </div>
      <span class="dim small">Default tones can't be changed. Copy one, or open it and Save it under a name, to make it your own.</span>
    {:else}
      <div class="acts four">
        <button onclick={() => { store.duplicate(t); toneMenu = null }}>Copy</button>
        <button onclick={() => rename(t)}>Rename</button>
        <button onclick={() => addTag(t)}>Tag</button>
        <button class="danger" onclick={() => { toneMenu = null; store.deleteTone(t) }}>Delete</button>
      </div>
    {/if}
  </Popover>
{/if}

{#if slotMenu}
  {@const key = slotMenu.key}
  {@const t = toneOf(store.assignments[key])}
  <Popover at={slotMenu.at} onclose={() => (slotMenu = null)} width={320}>
    <b class="mtitle"><span class="chtext" style={chStyle(key)}>{key}</span> {t?.name ?? 'Empty'}</b>
    {#if t}
      <button class="primary" disabled={!ampReady} onclick={() => { slotMenu = null; store.writeChannel(key) }}>Write to amp</button>
      <button onclick={() => open(t)}>Open in editor</button>
      <button onclick={() => { store.assign(key, null); slotMenu = null }}>Clear</button>
    {:else}
      <p class="dim small hint">Tap a tone below, then pick {key} in its menu.</p>
    {/if}
  </Popover>
{/if}

<style>
  .lib { display: flex; flex-direction: column; height: 100%; gap: 12px; padding: 12px 16px 16px; }
  .channels { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 12px 16px 14px; flex: none; }
  .chead { margin-bottom: 10px; flex-wrap: wrap; }
  .slots { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
  .slot { display: flex; align-items: center; gap: 10px; min-height: 56px; padding: 0 12px; text-align: left; min-width: 0; }
  .slot { border-left: 5px solid var(--ch); background: color-mix(in srgb, var(--ch) 7%, var(--panel2)); }
  .slot.onamp { border-color: var(--ch); box-shadow: 0 0 0 1px var(--ch) inset; }
  .slot.empty .tn { color: var(--dim); font-style: italic; }
  .ch { font-weight: 700; color: var(--ch); font-size: 20px; }
  .tn { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
  .tools { flex: none; }
  .tools input { flex: 1; }
  .seg { display: flex; flex: none; border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
  .seg button { border: 0; border-radius: 0; min-height: 52px; padding: 0 18px; background: var(--panel); font-weight: 600; }
  .seg button + button { border-left: 1px solid var(--line); }
  .seg button.on { background: var(--accent-dim); color: var(--text, #fff); }
  .seg .n { font-size: 13px; color: var(--dim); margin-left: 4px; font-weight: 400; }
  .cats { display: flex; flex-wrap: wrap; gap: 8px; flex: none; }
  .cats button { min-height: 44px; padding: 0 16px; border-radius: 22px; font-size: 15px; }
  .cats button.on { background: var(--accent-dim); border-color: var(--accent); }
  .tone.builtin { background: color-mix(in srgb, var(--accent) 4%, var(--panel)); border-style: dashed; }
  .by { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .notes { margin: 0; color: var(--dim); font-size: 16px; line-height: 1.4; }
  .acts.one { grid-template-columns: 1fr; }
  .tones { flex: 1; min-height: 0; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 10px; }
  .tone { display: flex; flex-direction: column; align-items: stretch; gap: 6px; padding: 12px 14px; text-align: left; white-space: normal; border-radius: 12px; background: var(--panel); min-height: 96px; }
  .tone.current { border-color: var(--accent); }
  .tone.sel { background: #2c2518; }
  .top { gap: 6px; }
  .tname { font-size: 17px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .small { font-size: 13px; }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; min-height: 22px; }
  .chip { font-size: 12px; padding: 2px 8px; border-radius: 10px; background: var(--panel2); border: 1px solid var(--line); }
  .chip.tag { color: var(--accent); }
  .empty-msg { text-align: center; margin-top: 40px; }
  .mtitle { font-size: 22px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* The tone menu is the most-used popover: big, well-spaced targets. */
  .acts { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .acts button, .chans button { min-height: 72px; font-size: 19px; border-radius: 14px; }
  .acts.four { grid-template-columns: repeat(4, 1fr); }
  .acts.four button { padding: 0 6px; }
  .chans { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
  .chans button { font-weight: 700; font-size: 22px; }
  .hint { margin: 0; }
</style>
