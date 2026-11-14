<script lang="ts">
  // Grid of options for a popover; the selected one is highlighted. Picking doesn't close
  // anything, so you can tap through options and hear each one.
  let { options, value, onpick }: { options: string[]; value: number; onpick: (i: number) => void } = $props()
  let sel: HTMLButtonElement | undefined = $state()
  $effect(() => sel?.scrollIntoView({ block: 'nearest' }))
</script>

<div class="choices" class:wide={options.length > 8}>
  {#each options as o, i}
    {#if i === value}
      <button bind:this={sel} class="opt sel" onclick={() => onpick(i)}>{o}</button>
    {:else}
      <button class="opt" onclick={() => onpick(i)}>{o}</button>
    {/if}
  {/each}
</div>

<style>
  .choices { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; max-height: min(60vh, 520px); overflow-x: hidden; overflow-y: auto; overscroll-behavior-y: contain; overscroll-behavior-x: none; touch-action: pan-y; }
  .wide { grid-template-columns: repeat(3, 1fr); }
  .opt { min-height: 64px; white-space: normal; line-height: 1.15; padding: 6px 10px; font-size: 17px; }
  .sel { background: var(--accent); color: #1a1206; border-color: var(--accent); font-weight: 600; }
</style>
