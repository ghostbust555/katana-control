<script lang="ts">
  import { backend } from './lib/backend'
  import Popover from './components/Popover.svelte'
  import { pressAt, type Point } from './lib/press'
  import { channels, chStyle } from './lib/schema'
  import { PATCH_NAMES, store, type View } from './lib/store.svelte'
  import Editor from './views/Editor.svelte'
  import Guitars from './views/Guitars.svelte'
  import Library from './views/Library.svelte'
  import Setlists from './views/Setlists.svelte'

  store.init()

  const NAV: { view: View | 'community'; label: string; icon: string }[] = [
    { view: 'editor', label: 'Editor', icon: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4' },
    { view: 'library', label: 'Tones', icon: 'M4 5h16v4H4zM4 11h16v4H4zM4 17h10v3H4z' },
    { view: 'setlists', label: 'Setlists', icon: 'M3 6h11M3 11h11M3 16h7M18 17V5l4-1M18 17a2 2 0 1 1-4 0 2 2 0 0 1 4 0' },
    { view: 'guitars', label: 'Guitars', icon: 'M14 3l7 7-3 1-4-4 1-3zM12 8l4 4-6 6a3 3 0 11-4-4l6-6zM8 16l.01 0' },
    { view: 'community', label: 'Community', icon: 'M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18' },
  ]

  // Top-bar popovers: where each was opened, or null when closed.
  let guitarMenu = $state<Point | null>(null)
  let channelMenu = $state<Point | null>(null)
  let moreMenu = $state<Point | null>(null)
  const chName = (n: number) => PATCH_NAMES[n] ?? `Patch ${n}`
  function syncInfo() {
    if (store.synced) {
      store.toast('Live: the editor is what the amp is playing. Changes on either one apply to the other.')
      return
    }
    const p = store.channel !== null ? chName(store.channel) : 'its channel'
    store.confirm = {
      title: 'Editor and amp differ',
      body: `The amp is playing a different sound than the editor shows. Load the amp's sound (${p}) into the editor, or send the editor tone to the amp.`,
      actions: [
        { label: 'Cancel', run: () => {} },
        { label: '↓ Load from amp', run: () => store.pullFromAmp() },
        { label: '↑ Send to amp', primary: true, run: () => store.sendToAmp() },
      ],
    }
  }

  function saveAs() {
    store.ask = { title: 'Save as a new tone', value: `${store.tone.name} 2`, okLabel: 'Save', onsubmit: (v) => v.trim() && store.save(v.trim()) }
  }
  function rename() {
    store.ask = { title: 'Rename tone', value: store.tone.name, okLabel: 'Rename', onsubmit: (v) => v.trim() && store.rename(v.trim()) }
  }
  function save() {
    if (store.inLibrary) store.save()
    else store.ask = { title: 'Save tone', value: store.tone.name, okLabel: 'Save', onsubmit: (v) => v.trim() && store.save(v.trim()) }
  }

  function keys(e: KeyboardEvent) {
    if (store.ask || store.confirm) return
    const mod = e.ctrlKey || e.metaKey
    const typing = e.target instanceof HTMLInputElement && e.target.type !== 'range'
    if (mod && e.key === 's') { e.preventDefault(); save() }
    else if (typing) return
    else if (mod && e.key === 'z' && !e.shiftKey) { e.preventDefault(); store.undo() }
    else if (mod && (e.key === 'y' || (e.key === 'Z' && e.shiftKey))) { e.preventDefault(); store.redo() }
  }

  let askInput: HTMLInputElement | undefined = $state()
  $effect(() => { if (store.ask) askInput?.select() })
</script>

<svelte:window onkeydown={keys} />

<div class="shell">
  <nav class="rail" aria-label="Views">
    {#each NAV as n}
      <button class="navbtn" class:sel={store.view === n.view} disabled={n.view === 'community'}
        title={n.view === 'community' ? 'Coming later' : n.label} onclick={() => n.view !== 'community' && (store.view = n.view)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d={n.icon} /></svg>
        <span>{n.label}</span>
      </button>
    {/each}
    <span class="build" title="Build time">{__BUILD__}</span>
  </nav>

  <div class="main">
    <header class="top row">
      <button class="ghost title" onclick={rename} title="Rename">
        <span class="tname">{store.tone.name}</span>{#if store.dirty}<span class="mod" title="Unsaved changes">●</span>{/if}
      </button>
      <button class="ghost icon ur" title="Undo (Ctrl+Z)" disabled={!store.undoStack.length} onclick={() => store.undo()}>↶</button>
      <button class="ghost icon ur" title="Redo (Ctrl+Y)" disabled={!store.redoStack.length} onclick={() => store.redo()}>↷</button>
      <button class="primary" onclick={save} title="Ctrl+S">Save</button>
      <button onclick={(e) => (moreMenu = pressAt(e))}>More ▾</button>
      {#if moreMenu}
        <Popover at={moreMenu} onclose={() => (moreMenu = null)} width={260}>
          <button class="item" onclick={() => { moreMenu = null; saveAs() }}>Save as new…</button>
          <button class="item" onclick={() => { moreMenu = null; store.newTone() }}>New tone</button>
          <button class="item" disabled={!store.dirty} onclick={() => { moreMenu = null; store.revert() }}>Revert changes</button>
        </Popover>
      {/if}

      <button class="icon arrow" title="Load from amp: replace the editor tone with the amp's current sound"
        aria-label="Load from amp" disabled={!store.amp.connected || !!store.amp.busy} onclick={() => store.pullFromAmp()}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v13M6 11l6 6 6-6M5 21h14" /></svg>
      </button>
      <button class="icon arrow" title="Send to amp: put the editor tone on the amp"
        aria-label="Send to amp" disabled={!store.amp.connected || !!store.amp.busy} onclick={() => store.sendToAmp()}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20V7M6 13l6-6 6 6M5 3h14" /></svg>
      </button>

      {#if store.amp.connected}
        <button class="sync" class:live={store.synced} onclick={syncInfo}
          title={store.synced ? 'Live: editor and amp are in sync' : 'Not synced: the amp is playing something else'}
          aria-label={store.synced ? 'Live' : 'Not synced'}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            {#if store.synced}
              <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" />
            {:else}
              <path d="M9 15l-1 1a3.5 3.5 0 0 1-5-5l1-1M15 9l1-1a3.5 3.5 0 0 1 5 5l-1 1M8 3v3M3 8h3M16 21v-3M21 16h-3" />
            {/if}
          </svg>
        </button>
      {/if}

      <span class="grow"></span>
      {#if store.amp.busy}<span class="busy"><span class="spin"></span>{store.amp.busy}</span>{/if}

      {#if store.amp.connected}
        <button class="chip-btn chan" onclick={(e) => (channelMenu = pressAt(e))} title="Channel the amp is on: tap to switch">
          {#if store.channel !== null}
            <b class="chtext" style={chStyle(chName(store.channel))}>{chName(store.channel)}</b><span class="cname">{store.channelTone(store.channel) ?? ''}</span>
          {:else}<span class="dim">Channel ?</span>{/if}
          <span class="dim">▾</span>
        </button>
      {/if}
      <button class="chip-btn" onclick={(e) => (guitarMenu = pressAt(e))} title="Active guitar">
        🎸 {store.activeGuitar?.name ?? 'No guitar'} ▾
      </button>
      {#if channelMenu}
        <Popover at={channelMenu} onclose={() => (channelMenu = null)} width={300}>
          <b>Amp channel</b>
          {#each channels as c (c.key)}
            <button class="item" class:sel={store.channel === c.patch} style={chStyle(c.key)} disabled={!!store.amp.busy} onclick={() => store.selectChannel(c.key)}>
              <b class="chtext ck">{c.key}</b> <span class="dim">{store.channelTone(c.patch) ?? 'Unknown tone'}</span>
            </button>
          {/each}
        </Popover>
      {/if}
      {#if guitarMenu}
        <Popover at={guitarMenu} onclose={() => (guitarMenu = null)} width={280}>
          <b>Guitar</b>
          <button class="item" class:sel={!store.activeGuitarId} onclick={() => store.setActiveGuitar(null)}>No guitar</button>
          {#each store.guitars as g (g.id)}
            <button class="item" class:sel={store.activeGuitarId === g.id} onclick={() => store.setActiveGuitar(g.id)}>{g.name}</button>
          {/each}
          <button class="item ghost" onclick={() => { store.view = 'guitars'; guitarMenu = null }}>Manage guitars…</button>
        </Popover>
      {/if}
      {#if store.amp.connected}
        <button class="ghost conn on dotonly" onclick={() => store.disconnect()}
          title="Connected to {store.amp.port}{backend.mock ? ' (demo)' : ''}: tap to disconnect" aria-label="Connected: tap to disconnect">
          <span class="dot"></span>
        </button>
      {:else}
        <button class="chip-btn conn" disabled={!!store.amp.busy} onclick={() => store.connect()}><span class="dot"></span>Connect amp</button>
      {/if}
    </header>

    <main class="view">
      {#if store.view === 'editor'}<Editor />{:else if store.view === 'library'}<Library />{:else if store.view === 'setlists'}<Setlists />{:else}<Guitars />{/if}
    </main>
  </div>
</div>

<div class="toasts" aria-live="polite">
  {#each store.toasts as t (t.id)}<div class="toast" class:error={t.kind === 'error'}>{t.text}</div>{/each}
</div>

{#if store.confirm}
  {@const c = store.confirm}
  <div class="backdrop" role="presentation">
    <div class="dialog" role="alertdialog" aria-label={c.title}>
      <h2>{c.title}</h2>
      <p>{c.body}</p>
      <div class="row end">
        {#each c.actions as a}
          <button class:primary={a.primary} onclick={() => { const run = a.run; store.confirm = null; run() }}>{a.label}</button>
        {/each}
      </div>
    </div>
  </div>
{/if}

{#if store.ask}
  {@const a = store.ask}
  <div class="backdrop" role="presentation">
    <form class="dialog" aria-label={a.title} onsubmit={(e) => { e.preventDefault(); const v = askInput?.value ?? ''; const done = a.onsubmit; store.ask = null; done(v) }}>
      <h2>{a.title}</h2>
      <input bind:this={askInput} type="text" value={a.value} />
      <div class="row end">
        <button type="button" onclick={() => (store.ask = null)}>Cancel</button>
        <button class="primary" type="submit">{a.okLabel}</button>
      </div>
    </form>
  </div>
{/if}

<style>
  .shell { display: flex; height: 100%; }
  .rail { width: 88px; flex: none; background: var(--panel); border-right: 1px solid var(--line); display: flex; flex-direction: column; gap: 6px; padding: 10px 8px; }
  .navbtn { height: 72px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; padding: 0; border-color: transparent; background: transparent; font-size: 13px; }
  .navbtn svg { width: 26px; height: 26px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
  .navbtn.sel { background: var(--panel2); border-color: var(--line); color: var(--accent); }
  .navbtn:disabled { opacity: 0.35; }
  .build { margin-top: auto; font-size: 10px; color: var(--dim); text-align: center; line-height: 1.3; }
  .main { flex: 1; min-width: 0; display: flex; flex-direction: column; position: relative; }
  .top { height: 64px; flex: none; padding: 0 16px; border-bottom: 1px solid var(--line); gap: 8px; }
  .title { display: flex; align-items: center; gap: 6px; max-width: 360px; padding: 0 8px; }
  .tname { font-size: 20px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; }
  .mod { color: var(--accent); font-size: 14px; }
  .icon { width: var(--tap); padding: 0; font-size: 22px; }
  .arrow { display: grid; place-items: center; }
  .arrow svg { width: 24px; height: 24px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .ur { width: 32px; }
  .sync { width: 40px; display: grid; place-items: center; padding: 0; color: var(--warn, #e8a33d); border-color: color-mix(in srgb, currentColor 45%, transparent); }
  .sync.live { color: var(--ok); }
  .sync svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .chip-btn { border-radius: 22px; max-width: 240px; overflow: hidden; text-overflow: ellipsis; }
  .conn { display: flex; align-items: center; gap: 8px; }
  .dotonly { width: 28px; padding: 0; justify-content: center; }
  .chan { display: flex; align-items: center; gap: 8px; max-width: 280px; }

  .item { text-align: left; }
  .item.sel { border-color: var(--accent); background: #2c2518; }
  .item.sel[style] { border-color: var(--ch); background: color-mix(in srgb, var(--ch) 14%, var(--panel2)); }
  .ck { margin-right: 6px; }
  .cname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--dim); }
  .conn.on .dot { background: var(--ok); box-shadow: 0 0 6px var(--ok); }
  .busy { display: flex; align-items: center; gap: 8px; color: var(--dim); font-size: 14px; }
  .spin { width: 16px; height: 16px; border: 2px solid var(--line); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .view { flex: 1; min-height: 0; }
  .toasts { position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; gap: 8px; z-index: 60; pointer-events: none; }
  .toast { background: var(--panel2); border: 1px solid var(--line); border-radius: 10px; padding: 10px 16px; box-shadow: 0 6px 20px #0008; max-width: 70vw; }
  .toast.error { border-color: var(--danger); }
  .backdrop { position: fixed; inset: 0; background: #0009; display: grid; place-items: center; z-index: 55; }
  .dialog { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 20px; width: min(520px, 92vw); display: flex; flex-direction: column; gap: 14px; }
  .dialog p { margin: 0; color: var(--dim); line-height: 1.4; }
  .end { justify-content: flex-end; flex-wrap: wrap; }
</style>
