import { useEffect, useState } from 'react';

/**
 * A frame counter that advances every `intervalMs` while `active`. Drives the
 * spinner glyph and the blinking bullet of a running tool; each caller owns
 * its own timer so only that small component repaints.
 */
export function useTicker(intervalMs: number, active = true): number {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setFrame((f) => f + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, active]);

  return frame;
}
