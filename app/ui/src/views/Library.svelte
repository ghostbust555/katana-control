<script lang="ts">
  import { channels, format, layout, param } from '../lib/schema'
  import { store, type Tone } from '../lib/store.svelte'

  let query = $state('')
  let assigning = $state<Tone | null>(null)
  let fileInput: HTMLInputElement | undefined = $state()

  const shown = $derived(
    store.tones.filter((t) => {
      const q = query.trim().toLowerCase()
      return !q || t.name.toLowerCase().includes(q) || t.tags.some((x) => x.toLowerCase().includes(q))
    }),
  )
  const toneName = (id: string | null) => store.tones.find((t) => t.id === id)?.name
  const ampType = (t: Tone) => format(param('amp.type'), t.params['amp.type'])
  /** Blocks switched on in this tone, for the card's chips. */
  const activeBlocks = (t: Tone) =>
    layout.filter((b) => b.switch && ['booster', 'mod', 'fx', 'delay', 'delay2', 'reverb'].includes(b.key) && t.params[b.switch]).map((b) => b.label)
  const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

  function addTag(t: Tone) {
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
</script>

<div class="lib">
  <section class="channels">
    <div class="row chead">
      <h2 class="grow">Amp channels</h2>
      <span class="dim">{store.activeGuitar ? `Written for ${store.activeGuitar.name}` : 'No guitar adjustments'}</span>
      <button class="primary" disabled={!store.amp.connected || !Object.values(store.assignments).some(Boolean) || !!store.amp.busy}
        onclick={() => store.writeAllChannels()}>Write all to amp</button>
    </div>
    <div class="slots">
      {#each channels as c (c.key)}
        {@const name = toneName(store.assignments[c.key])}
        <div class="slot" class:empty={!name}>
          <div class="row">
            <span class="ch">{c.key}</span>
            <span class="grow tn">{name ?? 'Empty'}</span>
          </div>
          <div class="row">
            <button class="grow" disabled={!name || !store.amp.connected || !!store.amp.busy} onclick={() => store.writeChannel(c.key)}>Write</button>
            <button disabled={!name} onclick={() => store.assign(c.key, null)}>Clear</button>
          </div>
        </div>
      {/each}
    </div>
  </section>

  <div class="row tools">
    <input type="search" placeholder="Search tones or tags" bind:value={query} />
    <button onclick={() => { store.newTone(); store.view = 'editor' }}>New tone</button>
    <button onclick={() => fileInput?.click()} title="Import tones from BOSS Tone Studio / Tone Exchange liveset files">Import .tsl…</button>
    <input bind:this={fileInput} type="file" accept=".tsl" multiple hidden
      onchange={(e) => { const fs = [...(e.currentTarget.files ?? [])]; e.currentTarget.value = ''; if (fs.length) store.importTsl(fs) }} />
  </div>

  <div class="tones scroll">
    {#if shown.length === 0}
      <p class="dim empty-msg">{store.tones.length ? 'No tones match.' : 'No saved tones yet. Make one in the Editor and press Save.'}</p>
    {/if}
    <div class="grid">
      {#each shown as t (t.id)}
        <article class="tone" class:current={t.id === store.tone.id}>
          <button class="ghost open" onclick={() => store.open(t)}>
            <h3>{t.name}</h3>
            <span class="dim small">{ampType(t)} · {when(t.modified)}</span>
            <span class="chips">
              {#each activeBlocks(t) as b}<span class="chip">{b}</span>{/each}
              {#each t.tags as tag}<span class="chip tag">#{tag}</span>{/each}
            </span>
          </button>
          <div class="row actions">
            <button onclick={() => (assigning = t)}>Assign</button>
            <button disabled={!store.amp.connected || !!store.amp.busy} onclick={() => store.audition(t)}>Play</button>
            <span class="grow"></span>
            <button class="ghost" title="Add tag" onclick={() => addTag(t)}>#</button>
            <button class="ghost" title="Duplicate" onclick={() => store.duplicate(t)}>⧉</button>
            <button class="ghost danger" title="Delete" onclick={() => store.deleteTone(t)}>✕</button>
          </div>
        </article>
      {/each}
    </div>
  </div>
</div>

{#if assigning}
  {@const t = assigning}
  <div class="backdrop" role="presentation" onclick={() => (assigning = null)}>
    <div class="sheet" role="dialog" aria-label="Assign to channel" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
      <h2>Assign "{t.name}" to</h2>
      <div class="pick">
        {#each channels as c (c.key)}
          <button class="big" onclick={() => { store.assign(c.key, t.id); assigning = null }}>
            <b>{c.key}</b><span class="dim small">{toneName(store.assignments[c.key]) ?? 'Empty'}</span>
          </button>
        {/each}
      </div>
      <button onclick={() => (assigning = null)}>Cancel</button>
    </div>
  </div>
{/if}

<style>
  .lib { display: flex; flex-direction: column; height: 100%; gap: 12px; padding: 12px 16px 16px; }
  .channels { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 12px 16px 14px; flex: none; }
  .chead { margin-bottom: 10px; flex-wrap: wrap; }
  .slots { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
  .slot { background: var(--panel2); border: 1px solid var(--line); border-radius: var(--r); padding: 10px; display: flex; flex-direction: column; gap: 8px; }
  .slot.empty .tn { color: var(--dim); font-style: italic; }
  .ch { font-weight: 700; color: var(--accent); font-size: 20px; width: 34px; }
  .tn { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
  .tools { flex: none; }
  .tools input { flex: 1; }
  .tones { flex: 1; min-height: 0; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px; }
  .tone { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; display: flex; flex-direction: column; }
  .tone.current { border-color: var(--accent); }
  .open { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; padding: 12px 14px; height: auto; text-align: left; white-space: normal; border-radius: 12px 12px 0 0; }
  .open h3 { font-size: 18px; }
  .small { font-size: 13px; }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; min-height: 22px; }
  .chip { font-size: 12px; padding: 2px 8px; border-radius: 10px; background: var(--panel2); border: 1px solid var(--line); }
  .chip.tag { color: var(--accent); }
  .actions { padding: 0 10px 10px; gap: 6px; }
  .actions .ghost { width: var(--tap); padding: 0; }
  .empty-msg { text-align: center; margin-top: 40px; }
  .backdrop { position: fixed; inset: 0; background: #0009; display: grid; place-items: center; z-index: 50; }
  .sheet { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 18px; display: flex; flex-direction: column; gap: 14px; width: min(560px, 92vw); }
  .pick { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .big { min-height: 72px; display: flex; flex-direction: column; justify-content: center; gap: 2px; white-space: normal; }
  .big b { font-size: 20px; }
</style>
