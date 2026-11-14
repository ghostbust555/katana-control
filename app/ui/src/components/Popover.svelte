<script lang="ts">
  // Floating panel shown where the user pressed. It stays open while you use it and closes
  // only when you tap outside it (or press Escape). The tap outside is swallowed, so it
  // doesn't also press whatever is underneath.
  import type { Snippet } from 'svelte'

  let { at, onclose, width = 360, children }: {
    /** Press position (client coordinates). */
    at: { x: number; y: number }
    onclose: () => void
    width?: number
    children: Snippet
  } = $props()

  let w = $state(0)
  let h = $state(0)
  const GAP = 14
  const M = 8
  const left = $derived(Math.max(M, Math.min(window.innerWidth - w - M, at.x - w / 2)))
  // Below the press if it fits, otherwise above; failing both, as high as needed to fit.
  const top = $derived.by(() => {
    const below = at.y + GAP
    if (below + h <= window.innerHeight - M) return below
    const above = at.y - GAP - h
    return above >= M ? above : Math.max(M, window.innerHeight - h - M)
  })
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div class="scrim" role="presentation"
  onpointerdown={(e) => { e.preventDefault(); e.stopPropagation(); onclose() }}
  onclick={(e) => e.stopPropagation()}></div>
<div class="pop" role="dialog" tabindex="-1" bind:clientWidth={w} bind:clientHeight={h}
  style="left:{left}px; top:{top}px; width:min({width}px, calc(100vw - 16px)); visibility:{w ? 'visible' : 'hidden'}">
  {@render children()}
</div>

<style>
  .scrim { position: fixed; inset: 0; z-index: 70; background: #0005; }
  .pop {
    position: fixed; z-index: 71; max-height: calc(100vh - 16px); overflow-y: auto; overscroll-behavior: contain;
    background: var(--panel); border: 1px solid #4a505b; border-radius: 14px; padding: 12px;
    box-shadow: 0 14px 40px #000a; display: flex; flex-direction: column; gap: 10px;
  }
</style>
