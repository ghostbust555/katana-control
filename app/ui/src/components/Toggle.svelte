<script lang="ts">
  let { on, label = '', onchange }: { on: boolean; label?: string; onchange: (v: boolean) => void } = $props()
</script>

<button class="toggle" class:on role="switch" aria-checked={on} aria-label={label} onclick={() => onchange(!on)}>
  <span class="knob"></span>
  <span class="txt">{on ? 'On' : 'Off'}</span>
</button>

<style>
  .toggle { display: inline-flex; align-items: center; gap: 10px; padding: 0 14px 0 6px; min-width: 96px; }
  .knob { width: 44px; height: 26px; border-radius: 13px; background: var(--line); position: relative; transition: background 0.15s; }
  .knob::after { content: ''; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: var(--dim); transition: transform 0.15s, background 0.15s; }
  .on .knob { background: var(--accent-dim); }
  .on .knob::after { transform: translateX(18px); background: var(--accent); }
  .txt { min-width: 26px; text-align: left; }
</style>
