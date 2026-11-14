<script lang="ts">
  // Big slider with − and + at its ends. Tap ± for one step; hold to repeat, speeding up.
  let { value, min, max, label, onchange, centered = false }: {
    value: number; min: number; max: number; label: string; onchange: (v: number) => void
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

<div class="stepper">
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
  .step { width: 52px; min-height: 52px; padding: 0; font-size: 26px; flex: none; touch-action: none; }
  input { flex: 1; min-width: 0; }
  .centered::-webkit-slider-runnable-track {
    background: linear-gradient(to right, var(--line) var(--lo), var(--accent) var(--lo), var(--accent) var(--hi), var(--line) var(--hi));
  }
</style>
