// TV Broadcast Mode's remote control (src/components/TvBroadcast.tsx): the Fire TV remote's D-pad moves the focus
// between the screen's controls (marked data-tv-focus) to the nearest one in that direction, Select presses the
// focused one (the browser sends Enter, which clicks a button), and Back closes an open panel. No imports, so Node
// runs it directly (npm run test:tv).

export type Direction = 'up' | 'down' | 'left' | 'right';
export type Box = { left: number; top: number; width: number; height: number };

// The D-pad's direction of a key press: Arrow keys, older browsers' Up/Down/Left/Right, or Android key codes
export function keyDirection(event: { key?: string; keyCode?: number }): Direction | null {
  switch (event.key) {
    case 'ArrowUp':
    case 'Up':
      return 'up';
    case 'ArrowDown':
    case 'Down':
      return 'down';
    case 'ArrowLeft':
    case 'Left':
      return 'left';
    case 'ArrowRight':
    case 'Right':
      return 'right';
  }
  switch (event.keyCode) {
    case 38:
    case 19:
      return 'up';
    case 40:
    case 20:
      return 'down';
    case 37:
    case 21:
      return 'left';
    case 39:
    case 22:
      return 'right';
  }
  return null;
}

// The remote's Back button, where the browser hands it to the page rather than going back itself (Escape on most,
// GoBack/BrowserBack and Android's code 4, LG's 461, Samsung's 10009)
export function isBackKey(event: { key?: string; keyCode?: number }): boolean {
  return (
    event.key === 'Escape' ||
    event.key === 'GoBack' ||
    event.key === 'BrowserBack' ||
    [4, 27, 461, 10009].includes(event.keyCode ?? -1)
  );
}

// The Play/Pause button
export function isPlayPauseKey(event: { key?: string; keyCode?: number }): boolean {
  return event.key === 'MediaPlayPause' || event.keyCode === 179 || event.keyCode === 85;
}

// How far apart two ranges are along one axis: 0 when they overlap
function gap(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  if (aEnd < bStart) return bStart - aEnd;
  if (bEnd < aStart) return aStart - bEnd;
  return 0;
}

// The index of the box to move to from `from` in this direction, or -1 when there's none that way. Only boxes whose
// centers lie that way count; the nearest wins, sideways distance counting double, so the focus moves in a straight
// line where it can.
export function nextFocus(from: Box, boxes: Box[], direction: Direction): number {
  const cx = from.left + from.width / 2;
  const cy = from.top + from.height / 2;
  let best = -1;
  let bestScore = Infinity;
  boxes.forEach((box, i) => {
    const bx = box.left + box.width / 2;
    const by = box.top + box.height / 2;
    const horizontal = direction === 'left' || direction === 'right';
    const along = direction === 'right' ? bx - cx : direction === 'left' ? cx - bx : direction === 'down' ? by - cy : cy - by;
    if (along <= 1) return;
    const sideways = horizontal
      ? gap(from.top, from.top + from.height, box.top, box.top + box.height)
      : gap(from.left, from.left + from.width, box.left, box.left + box.width);
    const score = along + sideways * 2;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}
