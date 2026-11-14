<script lang="ts">
  // Small knob icon: a 270° arc filled to `frac` (0..1) with a pointer.
  let { frac, size = 30 }: { frac: number; size?: number } = $props()
  const R = 11
  const C = 12
  const pt = (a: number) => [C + R * Math.cos(a), C + R * Math.sin(a)]
  const a0 = (135 * Math.PI) / 180
  const span = (270 * Math.PI) / 180
  function arc(f: number) {
    const [x0, y0] = pt(a0)
    const [x1, y1] = pt(a0 + span * f)
    return `M${x0} ${y0}A${R} ${R} 0 ${span * f > Math.PI ? 1 : 0} 1 ${x1} ${y1}`
  }
  const f = $derived(Math.min(1, Math.max(0, frac)))
  const tip = $derived(pt(a0 + span * f).map((v, i) => (v - C) * 0.55 + C))
</script>

<svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
  <path d={arc(1)} class="track" />
  {#if f > 0.001}<path d={arc(f)} class="val-arc" />{/if}
  <line x1={C} y1={C} x2={tip[0]} y2={tip[1]} class="ptr" />
</svg>

<style>
  svg { flex: none; }
  path { fill: none; stroke-width: 2.6; stroke-linecap: round; }
  .track { stroke: #4a505b; }
  .val-arc { stroke: var(--c, var(--accent)); }
  .ptr { stroke: var(--text); stroke-width: 2.2; stroke-linecap: round; }
</style>
