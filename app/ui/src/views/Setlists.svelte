<script lang="ts">
  import Choices from '../components/Choices.svelte'
  import Popover from '../components/Popover.svelte'
  import { pressAt, type Point } from '../lib/press'
  import { channels } from '../lib/schema'
  import { store, type Song } from '../lib/store.svelte'

  let selectedId = $state<string | null>(store.liveSong?.setlistId ?? store.setlists[0]?.id ?? null)
  const list = $derived(store.setlists.find((x) => x.id === selectedId) ?? null)
  let editing = $state(false)
  /** Song + channel whose tone is being chosen in edit mode. */
  let picking = $state<{ song: Song; key: string; at: Point } | null>(null)
  /** Song whose menu (rename / move / remove) is open. */
  let songMenu = $state<{ i: number; at: Point } | null>(null)

  const liveIndex = $derived(list && store.liveSong?.setlistId === list.id ? list.songs.findIndex((s) => s.id === store.liveSong!.songId) : -1)
  const pickTones = $derived([...store.tones].sort((a, b) => a.name.localeCompare(b.name)))
  const toneName = (id: string | null | undefined) => (id ? (store.tones.find((t) => t.id === id)?.name ?? 'Deleted tone') : null)
  const canPlay = $derived(store.amp.connected && !store.amp.busy)

  function add() {
    selectedId = store.addSetlist().id
    editing = true
  }
  function step(dir: number) {
    if (!list || !list.songs.length || !canPlay) return
    const i = liveIndex < 0 ? 0 : Math.min(list.songs.length - 1, Math.max(0, liveIndex + dir))
    if (i !== liveIndex) store.applySong(list, list.songs[i])
  }
  function move(i: number, dir: number) {
    const s = list!.songs
    const j = i + dir
    if (j < 0 || j >= s.length) return
    ;[s[i], s[j]] = [s[j], s[i]]
    store.persistSetlists()
  }
  function remove(i: number) {
    list!.songs.splice(i, 1)
    store.persistSetlists()
  }

  // Page-turner pedals and keyboards: PageDown / → / Space = next song, PageUp / ← = previous.
  function keys(e: KeyboardEvent) {
    if (editing || picking || songMenu || store.ask || store.confirm) return
    if (e.target instanceof HTMLInputElement && e.target.type !== 'range') return
    if (['PageDown', 'ArrowRight', ' '].includes(e.key)) { e.preventDefault(); step(1) }
    else if (['PageUp', 'ArrowLeft'].includes(e.key)) { e.preventDefault(); step(-1) }
  }
</script>

<svelte:window onkeydown={keys} />

<div class="setlists">
  <aside class="list">
    <div class="row"><h2 class="grow">Setlists</h2><button onclick={add}>Add</button></div>
    {#each store.setlists as x (x.id)}
      <button class="item" class:open={x.id === selectedId} onclick={() => { selectedId = x.id; editing = false }}>
        <span class="grow name">{x.name}</span>
        <span class="dim small">{x.songs.length} song{x.songs.length === 1 ? '' : 's'}</span>
      </button>
    {/each}
    <p class="dim small hint">Each song puts four tones on A1, A2, B1 and B2. Tap a song, or press Next, to load it onto the amp.</p>
  </aside>

  <section class="main">
    {#if !list}
      <div class="empty">
        <p class="dim">A setlist is a list of songs, each with the tones it needs on the amp's four channels. Switch songs with one tap while you play.</p>
        <button class="primary" onclick={add}>Make a setlist</button>
      </div>
    {:else if editing}
      <div class="row head">
        <input type="text" class="title" aria-label="Setlist name" value={list.name}
          oninput={(e) => { list.name = e.currentTarget.value; store.persistSetlists() }} />
        <button class="danger" onclick={() => store.deleteSetlist(list, () => { selectedId = store.setlists[0]?.id ?? null; editing = false })}>Delete</button>
        <button class="primary" onclick={() => (editing = false)}>Done</button>
      </div>
      <div class="songs scroll">
        {#each list.songs as song, i (song.id)}
          <div class="erow">
            <button class="sbtn" onclick={(e) => (songMenu = { i, at: pressAt(e) })}>
              <span class="num">{i + 1}</span><b class="grow sn">{song.name}</b><span class="dim">⋯</span>
            </button>
            <div class="chans">
              {#each channels as c (c.key)}
                {@const n = toneName(song.channels[c.key])}
                <button class="chan" class:none={!n} onclick={(e) => (picking = { song, key: c.key, at: pressAt(e) })}>
                  <span class="ck">{c.key}</span><span class="tn">{n ?? 'Keep'}</span>
                </button>
              {/each}
            </div>
          </div>
        {/each}
        <button class="addsong" onclick={() => store.addSong(list)}>+ Add song</button>
        {#if !store.tones.length}<p class="dim">Save some tones in the Editor first; songs pick from them.</p>{/if}
      </div>
    {:else}
      <div class="row head">
        <h2 class="grow title-ro">{list.name}</h2>
        <button onclick={() => (editing = true)}>Edit</button>
      </div>
      {#if list.songs.length}
        <div class="row nav">
          <button class="big" disabled={!canPlay || liveIndex <= 0} onclick={() => step(-1)}>◀ Previous</button>
          <div class="grow now">
            <span class="dim small">{liveIndex >= 0 ? `Song ${liveIndex + 1} of ${list.songs.length}` : 'Nothing loaded yet'}</span>
            <b>{liveIndex >= 0 ? list.songs[liveIndex].name : '—'}</b>
          </div>
          <button class="big primary" disabled={!canPlay || liveIndex >= list.songs.length - 1} onclick={() => step(1)}>
            {liveIndex < 0 ? 'Start ▶' : 'Next ▶'}
          </button>
        </div>
        {#if !store.amp.connected}<p class="dim warn">Connect the amp to load songs.</p>{/if}
        <div class="songs scroll">
          {#each list.songs as song, i (song.id)}
            <button class="prow" class:live={i === liveIndex} class:next={i === liveIndex + 1} disabled={!canPlay}
              onclick={() => store.applySong(list, song)}>
              <span class="num">{i + 1}</span>
              <span class="sname">{song.name}{#if i === liveIndex}<span class="badge">On amp</span>{/if}</span>
              <span class="pchans">
                {#each channels as c (c.key)}
                  {@const n = toneName(song.channels[c.key])}
                  <span class="pc" class:none={!n}><b>{c.key}</b> {n ?? '–'}</span>
                {/each}
              </span>
            </button>
          {/each}
        </div>
      {:else}
        <div class="empty">
          <p class="dim">No songs yet.</p>
          <button class="primary" onclick={() => { store.addSong(list); editing = true }}>Add a song</button>
        </div>
      {/if}
    {/if}
  </section>
</div>

{#if picking}
  {@const p = picking}
  <Popover at={p.at} onclose={() => (picking = null)} width={560}>
    <b>{p.song.name}: tone for {p.key}</b>
    <Choices options={["Keep what's on the amp", ...pickTones.map((t) => t.name)]}
      value={p.song.channels[p.key] ? pickTones.findIndex((t) => t.id === p.song.channels[p.key]) + 1 : 0}
      onpick={(i) => { p.song.channels[p.key] = i === 0 ? null : pickTones[i - 1].id; store.persistSetlists() }} />
  </Popover>
{/if}

{#if songMenu && list}
  {@const i = songMenu.i}
  {@const song = list.songs[i]}
  {#if song}
    <Popover at={songMenu.at} onclose={() => (songMenu = null)} width={380}>
      <input type="text" aria-label="Song name" value={song.name}
        oninput={(e) => { song.name = e.currentTarget.value; store.persistSetlists() }} />
      <div class="macts">
        <button disabled={i === 0} onclick={() => { move(i, -1); songMenu = { ...songMenu!, i: i - 1 } }}>▲ Up</button>
        <button disabled={i === list.songs.length - 1} onclick={() => { move(i, 1); songMenu = { ...songMenu!, i: i + 1 } }}>▼ Down</button>
        <button class="danger" onclick={() => { remove(i); songMenu = null }}>Remove</button>
      </div>
    </Popover>
  {/if}
{/if}

<style>
  .setlists { display: grid; grid-template-columns: 260px 1fr; gap: 12px; height: 100%; padding: 12px 16px 16px; }
  .list { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 12px; display: flex; flex-direction: column; gap: 8px; overflow-y: auto; }
  .item { display: flex; align-items: center; gap: 8px; min-height: 56px; text-align: left; }
  .item.open { border-color: var(--accent); background: #2c2518; }
  .name { overflow: hidden; text-overflow: ellipsis; font-weight: 600; }
  .small { font-size: 13px; }
  .hint { margin-top: auto; line-height: 1.35; }
  .main { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 14px 16px; display: flex; flex-direction: column; gap: 12px; min-height: 0; }
  .head { flex: none; }
  .title { flex: 1; font-size: 20px; font-weight: 600; }
  .title-ro { font-size: 22px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .songs { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 8px; padding-right: 2px; }
  .num { width: 32px; height: 32px; flex: none; border-radius: 50%; display: grid; place-items: center; background: var(--bg); border: 1px solid var(--line); font-weight: 700; font-variant-numeric: tabular-nums; }

  /* edit mode */
  .erow { background: var(--panel2); border: 1px solid var(--line); border-radius: var(--r); padding: 8px; display: flex; flex-direction: column; gap: 8px; flex: none; }
  .chans { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
  .sbtn { display: flex; align-items: center; gap: 10px; text-align: left; background: transparent; border-color: transparent; padding: 0 6px; }
  .sn { font-size: 17px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .macts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
  .chan { display: flex; gap: 8px; align-items: center; padding: 0 10px; text-align: left; background: var(--bg); min-width: 0; }
  .chan.none .tn { color: var(--dim); font-style: italic; }
  .ck { font-weight: 700; color: var(--accent); flex: none; }
  .tn { overflow: hidden; text-overflow: ellipsis; }
  .addsong { flex: none; border-style: dashed; min-height: 56px; }

  /* play mode */
  .nav { flex: none; background: var(--panel2); border: 1px solid var(--line); border-radius: var(--r); padding: 8px; }
  .big { min-height: 64px; font-size: 18px; padding: 0 22px; }
  .now { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 2px; }
  .now b { font-size: 22px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .warn { margin: 0; }
  .prow { flex: none; display: grid; grid-template-columns: 32px minmax(140px, 1fr) minmax(0, 2.4fr); align-items: center; gap: 12px; min-height: 64px; padding: 6px 12px; text-align: left; }
  .prow:disabled { opacity: 0.75; }
  .prow.live { border-color: var(--accent); background: #2c2518; }
  .prow.live .num { background: var(--accent); color: #1a1206; border-color: var(--accent); }
  .prow.next { border-color: #4a505b; }
  .sname { font-size: 18px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: flex; align-items: center; gap: 8px; }
  .badge { font-size: 12px; font-weight: 700; color: #1a1206; background: var(--accent); border-radius: 6px; padding: 2px 6px; }
  .pchans { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
  .pc { font-size: 13px; color: var(--text); background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 4px 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pc b { color: var(--accent); }
  .pc.none { color: var(--dim); }
  .empty { margin: auto; max-width: 460px; text-align: center; display: flex; flex-direction: column; gap: 16px; align-items: center; }
</style>
