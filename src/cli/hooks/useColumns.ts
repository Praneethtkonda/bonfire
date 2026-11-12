import { useEffect, useState } from 'react';
import { useStdout } from 'ink';

const FALLBACK_COLUMNS = 80;

/** Terminal width in columns, updated when the window is resized. */
export function useColumns(): number {
  const { stdout } = useStdout();
  const [columns, setColumns] = useState(() => stdout?.columns || FALLBACK_COLUMNS);

  useEffect(() => {
    if (!stdout || typeof stdout.on !== 'function') return;
    const onResize = () => setColumns(stdout.columns || FALLBACK_COLUMNS);
    stdout.on('resize', onResize);
    return () => {
      stdout.off('resize', onResize);
    };
  }, [stdout]);

  return columns;
}
