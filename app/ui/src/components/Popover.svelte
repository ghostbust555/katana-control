<script lang="ts">
  // Floating panel shown where the user pressed. It stays open while you use it and closes
  // only when you tap outside it (or press Escape). The tap outside only closes it: it never
  // also presses whatever is underneath.
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

  // A tap outside hides the popover at once, but the scrim stays until that tap's click has
  // arrived and been swallowed. Removing it on pointerdown let the click fall through to
  // whatever was underneath.
  let closing = $state(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  function finish() {
    clearTimeout(timer)
    onclose()
  }
  /** In case no click follows (the finger slid or the touch was cancelled). */
  function finishSoon() {
    clearTimeout(timer)
    timer = setTimeout(finish, 400)
  }
  $effect(() => () => clearTimeout(timer))
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div class="scrim" class:closing role="presentation"
  onpointerdown={(e) => { e.preventDefault(); e.stopPropagation(); closing = true }}
  onpointerup={finishSoon} onpointercancel={finishSoon}
  onclick={(e) => { e.preventDefault(); e.stopPropagation(); finish() }}></div>
<div class="pop" role="dialog" tabindex="-1" bind:clientWidth={w} bind:clientHeight={h}
  style="left:{left}px; top:{top}px; width:min({width}px, calc(100vw - 16px)); visibility:{w && !closing ? 'visible' : 'hidden'}">
  {@render children()}
</div>

<style>
  .scrim { position: fixed; inset: 0; z-index: 70; background: #0005; }
  .scrim.closing { background: transparent; }
  .pop {
    position: fixed; z-index: 71; max-height: calc(100vh - 16px); overflow-x: hidden; overflow-y: auto; overscroll-behavior-y: contain; overscroll-behavior-x: none; touch-action: pan-y;
    background: var(--panel); border: 1px solid #4a505b; border-radius: 16px; padding: 16px;
    box-shadow: 0 14px 40px #000a; display: flex; flex-direction: column; gap: 12px; font-size: 17px;
  }
  /* Room for imprecise fingers: every control in a popover is at least 56px tall. */
  .pop :global(button), .pop :global(input[type='text']), .pop :global(input[type='search']) { min-height: 56px; }
</style>
