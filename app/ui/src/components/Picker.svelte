<script lang="ts">
  // Full-screen-ish chooser for long option lists (FX types, frequencies...): big tap targets.
  let { title, options, value, onpick, onclose }: {
    title: string; options: string[]; value: number; onpick: (i: number) => void; onclose: () => void
  } = $props()
  let first: HTMLButtonElement | undefined = $state()
  $effect(() => first?.focus())
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />
<div class="backdrop" role="presentation" onclick={onclose}>
  <div class="sheet" role="dialog" aria-label={title} tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
    <div class="head row"><h2 class="grow">{title}</h2><button class="ghost" onclick={onclose}>Close</button></div>
    <div class="grid scroll">
      {#each options as o, i}
        {#if i === value}
          <button bind:this={first} class="opt sel" onclick={() => onpick(i)}>{o}</button>
        {:else}
          <button class="opt" onclick={() => onpick(i)}>{o}</button>
        {/if}
      {/each}
    </div>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: #0009; display: grid; place-items: center; z-index: 50; }
  .sheet { width: min(900px, 94vw); max-height: 86vh; display: flex; flex-direction: column; background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 16px; gap: 12px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
  .opt { min-height: 56px; white-space: normal; line-height: 1.15; }
  .sel { background: var(--accent); color: #1a1206; border-color: var(--accent); font-weight: 600; }
</style>
