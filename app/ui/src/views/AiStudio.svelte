<script lang="ts">
  // Describe a tone, the model builds it on the amp, you play and ask for changes, then save.
  import { tick } from 'svelte'
  import Popover from '../components/Popover.svelte'
  import { ai, type ChatEntry } from '../lib/ai.svelte'
  import { providers, type LlmSettings, type ModelInfo } from '../lib/llm'
  import { pressAt, type Point } from '../lib/press'
  import { format, layout, param } from '../lib/schema'
  import { store } from '../lib/store.svelte'

  ai.init()

  let draft = $state('')
  let log: HTMLDivElement | undefined = $state()
  let input: HTMLTextAreaElement | undefined = $state()
  let settingsAt = $state<Point | null>(null)
  let form = $state<LlmSettings>({ provider: 'anthropic', apiKey: '', model: '', baseUrl: '' })
  let open = $state<Record<number, boolean>>({})
  // Settings form: per-provider edits survive switching back and forth before saving.
  let drafts: Record<string, LlmSettings> = {}
  let models = $state<ModelInfo[] | null>(null)
  let modelsMsg = $state('')
  let modelQuery = $state('')
  const shownModels = $derived.by(() => {
    const q = modelQuery.trim().toLowerCase()
    return (models ?? []).filter((m) => !q || m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)).slice(0, 150)
  })

  function pickProvider(id: string) {
    drafts[form.provider] = { ...form }
    form = drafts[id] ?? ai.settingsFor(id)
    models = null
    modelsMsg = ''
  }
  async function browseModels() {
    const p = providers.find((x) => x.id === form.provider)
    if (!p?.listModels) return
    models = null
    modelQuery = ''
    modelsMsg = 'Loading models…'
    try {
      models = await p.listModels(form)
      modelsMsg = models.length ? '' : 'No models found.'
    } catch (e) {
      modelsMsg = e instanceof Error ? e.message : String(e)
    }
  }
  function pickModel(m: ModelInfo) {
    form.model = m.id
    models = null
  }

  const SUGGESTIONS = [
    'Crunchy AC/DC rhythm, no effects',
    'Gilmour-style solo: singing sustain, long delay',
    'Sparkly clean with chorus for arpeggios',
    'Tight modern metal rhythm for drop C',
    'Like one of my tones, but darker',
  ]

  const blocksOn = $derived(
    layout.filter((b) => b.switch && ['booster', 'mod', 'fx', 'delay', 'delay2', 'reverb', 'eq', 'ns', 'solo'].includes(b.key) && store.tone.params[b.switch])
      .map((b) => b.label),
  )
  const current = $derived(JSON.stringify(store.tone.params))

  // The setup screen edits the chosen provider's settings.
  $effect(() => {
    if (ai.loaded && !ai.ready) form = { ...ai.settings }
  })

  // Keep the newest message in view while it streams.
  $effect(() => {
    const last = ai.entries.at(-1)
    void last?.text, void ai.entries.length, void ai.status
    tick().then(() => log?.scrollTo({ top: log.scrollHeight }))
  })

  function send() {
    if (!draft.trim() || ai.busy) return
    ai.send(draft)
    draft = ''
  }
  function keydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }
  function suggest(s: string) {
    draft = s
    input?.focus()
  }
  function saveTone() {
    if (store.inLibrary) store.save()
    else store.ask = { title: 'Save tone', value: store.tone.name, okLabel: 'Save', onsubmit: (v) => v.trim() && store.save(v.trim()) }
  }
  function openSettings(e: MouseEvent) {
    form = { ...ai.settings }
    settingsAt = pressAt(e)
  }
  async function saveSettings() {
    await ai.saveSettings(form)
    settingsAt = null
  }
  const isCurrent = (e: ChatEntry) => !!e.snapshot && JSON.stringify(e.snapshot) === current
  const provider = $derived(providers.find((p) => p.id === form.provider) ?? providers[0])
</script>

{#snippet settingsForm()}
  <span class="dim">Model provider</span>
  <div class="provs">
    {#each providers as p (p.id)}
      <button class:sel={form.provider === p.id} onclick={() => pickProvider(p.id)}>{p.label}</button>
    {/each}
  </div>
  {#if provider.needsBaseUrl}
    <label class="field"><span class="dim">Server URL</span>
      <input type="text" placeholder="http://dev-box:1234/v1" bind:value={form.baseUrl} /></label>
  {/if}
  <label class="field"><span class="dim">API key{provider.needsKey ? '' : ' (if the server needs one)'}</span>
    <input type="password" placeholder={provider.id === 'anthropic' ? 'sk-ant-…' : ''} bind:value={form.apiKey} autocomplete="off" /></label>
  <div class="field"><span class="dim">Model</span>
    <div class="row modelrow">
      <input type="text" placeholder={provider.defaultModel} bind:value={form.model} />
      {#if provider.listModels}
        <button disabled={provider.needsKey && provider.id === 'anthropic' && !form.apiKey} onclick={() => (models ? (models = null) : browseModels())}>
          {models ? 'Close list' : 'Browse models'}</button>
      {/if}
    </div>
  </div>
  {#if modelsMsg}<p class="dim small">{modelsMsg}</p>{/if}
  {#if models}
    <input type="search" placeholder="Search {models.length} models (e.g. claude, gpt, gemini, free)" bind:value={modelQuery} />
    <div class="models scroll">
      {#each shownModels as m (m.id)}
        <button class="model" class:sel={form.model === m.id} onclick={() => pickModel(m)}>
          <b>{m.name}</b><span class="dim small">{m.id}{m.detail ? ' · ' + m.detail : ''}</span>
        </button>
      {/each}
    </div>
  {/if}
  {#if provider.hint}<p class="dim small">{provider.hint}</p>{/if}
{/snippet}

<div class="studio">
  <section class="chat">
    {#if !ai.loaded}
      <div class="grow"></div>
    {:else if !ai.ready}
      <div class="setup">
        <h2>Set up AI Studio</h2>
        <p class="dim">AI Studio needs a language model. Pick one and enter its details.</p>
        {@render settingsForm()}
        <button class="primary big" onclick={() => ai.saveSettings(form)}>Save and start</button>
      </div>
    {:else}
      <div class="log scroll" bind:this={log}>
        {#if !ai.entries.length}
          <div class="hello">
            <h2>Describe the tone you want</h2>
            <p class="dim">A song, an artist, a genre, or one of your tones. It is built and sent to the amp right away; play it, then say what to change.</p>
            <div class="sugg">
              {#each SUGGESTIONS as s}<button onclick={() => suggest(s)}>{s}</button>{/each}
            </div>
          </div>
        {/if}
        {#each ai.entries as e (e.id)}
          <div class="msg {e.role}" class:error={e.error}>
            {#if e.text}<p class="text">{e.text}</p>{/if}
            {#if e.pending && ai.status}<p class="status">{ai.status}</p>{/if}
            {#if e.changes?.length}
              <div class="row chg">
                <button class="ghost small" onclick={() => (open[e.id] = !open[e.id])}>
                  {e.changes.length} change{e.changes.length === 1 ? '' : 's'} {open[e.id] ? '▴' : '▾'}
                </button>
                <span class="grow"></span>
                {#if !e.pending}
                  {#if isCurrent(e)}<span class="now">On the amp now</span>
                  {:else}<button class="small" onclick={() => ai.restore(e)}>Use this version</button>{/if}
                {/if}
              </div>
              {#if open[e.id]}<ul class="chglist">{#each e.changes as c}<li>{c}</li>{/each}</ul>{/if}
            {/if}
          </div>
        {/each}
      </div>
      <div class="compose">
        <textarea bind:this={input} rows="2" placeholder="e.g. more bite, less fizz; or: Hendrix Little Wing" bind:value={draft} onkeydown={keydown}></textarea>
        {#if ai.busy}
          <button class="big" onclick={() => ai.stop()}>Stop</button>
        {:else}
          <button class="primary big" disabled={!draft.trim()} onclick={send}>Send</button>
        {/if}
      </div>
    {/if}
  </section>

  <aside class="side">
    <div class="card">
      <span class="dim small">Editor tone</span>
      <b class="tname">{store.tone.name}{store.dirty ? ' •' : ''}</b>
      <span class="dim">{format(param('amp.type'), store.tone.params['amp.type'])} · gain {store.tone.params['amp.gain']}</span>
      <span class="chips">{#each blocksOn as b}<span class="chip">{b}</span>{/each}</span>
      <span class="dim small">{store.amp.connected ? (store.synced ? 'Live on the amp' : 'Amp connected, not synced') : 'Amp not connected: changes stay in the editor'}</span>
    </div>
    <button class="primary big" onclick={saveTone}>Save tone</button>
    <button class="big" onclick={() => (store.view = 'editor')}>Open in editor</button>
    <span class="grow"></span>
    <button disabled={ai.busy || !ai.entries.length} onclick={() => ai.newChat()}>New conversation</button>
    <button onclick={openSettings}>AI settings · {ai.provider.label.split(' ')[0]}</button>
  </aside>
</div>

{#if settingsAt}
  <Popover at={settingsAt} onclose={() => (settingsAt = null)} width={560}>
    <b class="ptitle">AI settings</b>
    {@render settingsForm()}
    <div class="row"><span class="grow"></span><button class="primary" onclick={saveSettings}>Save</button></div>
  </Popover>
{/if}

<style>
  .studio { display: flex; height: 100%; gap: 14px; padding: 12px 16px 16px; }
  .chat { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
  .log { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 12px; padding-right: 4px; }
  .msg { max-width: 82%; padding: 12px 16px; border-radius: 16px; border: 1px solid var(--line); }
  .msg.user { align-self: flex-end; background: var(--accent-dim); border-color: transparent; }
  .msg.assistant { align-self: flex-start; background: var(--panel); }
  .msg.error { border-color: var(--danger); }
  .text { margin: 0; white-space: pre-wrap; user-select: text; font-size: 18px; line-height: 1.45; }
  .status { margin: 0; color: var(--dim); font-style: italic; }
  .chg { margin-top: 8px; gap: 8px; }
  .chglist { margin: 6px 0 0; padding-left: 20px; color: var(--dim); font-size: 14px; columns: 2; }
  .now { color: var(--ok); font-size: 14px; }
  .small { font-size: 14px; }
  button.small { min-height: 40px; }
  .hello { margin: auto; max-width: 640px; text-align: center; }
  .hello h2 { margin: 0 0 8px; }
  .sugg { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; margin-top: 18px; }
  .sugg button { min-height: 52px; border-radius: 26px; }
  .compose { display: flex; gap: 10px; align-items: stretch; flex: none; }
  .compose textarea { flex: 1; resize: none; min-height: 72px; padding: 12px 14px; font-size: 18px; border-radius: 14px; border: 1px solid var(--line); background: var(--panel2); }
  .big { min-height: 72px; font-size: 19px; border-radius: 14px; padding: 0 28px; }
  .side { width: 300px; flex: none; display: flex; flex-direction: column; gap: 10px; }
  .side > button:not(.big) { min-height: 56px; }
  .card { display: flex; flex-direction: column; gap: 6px; padding: 14px 16px; background: var(--panel); border: 1px solid var(--line); border-radius: 14px; }
  .tname { font-size: 20px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; }
  .chip { font-size: 13px; padding: 2px 8px; border-radius: 10px; background: var(--panel2); border: 1px solid var(--line); }
  .setup { margin: auto; width: min(620px, 100%); display: flex; flex-direction: column; gap: 12px; }
  .setup h2 { margin: 0; }
  .provs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  .modelrow { gap: 10px; }
  .modelrow input { flex: 1; min-width: 0; }
  .modelrow button { min-height: 56px; flex: none; }
  .models { max-height: 300px; display: flex; flex-direction: column; gap: 6px; padding-right: 4px; }
  .model { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; min-height: 60px; padding: 8px 14px; text-align: left; flex: none; width: 100%; white-space: normal; }
  .model span { overflow-wrap: anywhere; }
  .model.sel { border-color: var(--accent); background: var(--accent-dim); }
  input[type='search'] { min-height: 52px; padding: 0 14px; border-radius: 12px; border: 1px solid var(--line); background: var(--panel2); }
  .provs button { min-height: 60px; white-space: normal; line-height: 1.2; padding: 4px 10px; }
  .provs button.sel { background: var(--accent-dim); border-color: var(--accent); }
  .field { display: flex; flex-direction: column; gap: 4px; }
  .field input { min-height: 56px; padding: 0 14px; border-radius: 12px; border: 1px solid var(--line); background: var(--panel2); }
  .ptitle { font-size: 20px; }
</style>
