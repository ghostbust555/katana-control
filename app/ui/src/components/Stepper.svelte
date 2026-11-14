<script lang="ts">
  // Big slider with − and + at its ends. Tap ± for one step; hold to repeat, speeding up.
  let { value, min, max, label, onchange, centered = false, inline = false }: {
    value: number; min: number; max: number; label: string; onchange: (v: number) => void
    /** Smaller version for showing directly in a tile. */
    inline?: boolean
    /** Fill outward from the middle (for ± adjustments) instead of from the left. */
    centered?: boolean
  } = $props()

  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v)))
  const pos = $derived(((value - min) / Math.max(1, max - min)) * 100)
  const big = $derived(max - min > 400 ? 10 : 1)
  let timer = 0
  function hold(dir: number) {
    let v = clamp(value + dir)
    onchange(v)
    let n = 0
    timer = setTimeout(function rep() {
      n++
      v = clamp(v + dir * (n > 10 ? big * 5 : big))
      onchange(v)
      timer = setTimeout(rep, 60) as unknown as number
    }, 400) as unknown as number
  }
  const release = () => clearTimeout(timer)
</script>

<div class="stepper" class:inline>
  <button class="step" aria-label="Decrease {label}" disabled={value <= min}
    onpointerdown={() => hold(-1)} onpointerup={release} onpointerleave={release} onpointercancel={release}>−</button>
  <input type="range" {min} {max} step="1" {value} aria-label={label} class:centered
    style={centered ? `--lo:${Math.min(50, pos)}%; --hi:${Math.max(50, pos)}%` : `--fill:${pos}%`}
    oninput={(e) => onchange(clamp(+e.currentTarget.value))} />
  <button class="step" aria-label="Increase {label}" disabled={value >= max}
    onpointerdown={() => hold(1)} onpointerup={release} onpointerleave={release} onpointercancel={release}>+</button>
</div>

<style>
  .stepper { display: flex; align-items: center; gap: 10px; }
  .stepper { gap: 14px; }
  .step { width: 72px; min-height: 72px; padding: 0; font-size: 34px; flex: none; touch-action: none; border-radius: 14px; }
  /* Bigger than the global slider: this is the one you drag. */
  input { flex: 1; min-width: 0; height: 72px; }
  input::-webkit-slider-runnable-track { height: 12px; border-radius: 6px; }
  input::-webkit-slider-thumb { width: 46px; height: 46px; margin-top: -17px; border-width: 4px; }
  .inline { gap: 10px; }
  .inline .step { width: 56px; min-height: 52px; font-size: 28px; border-radius: 12px; }
  .inline input { height: 52px; }
  .inline input::-webkit-slider-runnable-track { height: 10px; border-radius: 5px; }
  /* Inline in a tile: take the section colour (--c) like the knobs do. */
  .inline input:not(.centered)::-webkit-slider-runnable-track { background: linear-gradient(to right, var(--c, var(--accent)) var(--fill, 0%), var(--line) var(--fill, 0%)); }
  .inline input::-webkit-slider-thumb { border-color: var(--c, var(--accent)); }
  .inline input::-webkit-slider-thumb { width: 38px; height: 38px; margin-top: -14px; border-width: 3px; }
  .centered::-webkit-slider-runnable-track {
    background: linear-gradient(to right, var(--line) var(--lo), var(--accent) var(--lo), var(--accent) var(--hi), var(--line) var(--hi));
  }
</style>
