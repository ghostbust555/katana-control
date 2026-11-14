export type Point = { x: number; y: number }

/** Where a click happened, for placing a popover there. Keyboard "clicks" have no position,
 *  so those use the bottom-centre of the pressed element. */
export function pressAt(e: MouseEvent): Point {
  if (e.detail > 0 && (e.clientX || e.clientY)) return { x: e.clientX, y: e.clientY }
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.bottom }
}
