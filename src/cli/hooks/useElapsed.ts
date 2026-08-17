import { useEffect, useRef, useState } from 'react';

/**
 * Seconds elapsed since `active` last became true, ticking once a second.
 * Copilot CLI shows this next to the spinner so a slow local model reads as
 * "still working" rather than "hung".
 */
export function useElapsed(active: boolean): number {
  const [seconds, setSeconds] = useState(0);
  const startedAt = useRef<number | null>(null);

  useEffect(() => {
    if (!active) {
      startedAt.current = null;
      setSeconds(0);
      return;
    }
    startedAt.current = Date.now();
    setSeconds(0);
    const id = setInterval(() => {
      if (startedAt.current !== null) {
        setSeconds(Math.floor((Date.now() - startedAt.current) / 1000));
      }
    }, 1000);
    return () => clearInterval(id);
  }, [active]);

  return seconds;
}
