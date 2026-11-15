import { useEffect, useState } from 'react';
import { useStdout } from 'ink';

export function useRows(): number {
  const { stdout } = useStdout();
  const [rows, setRows] = useState(() => stdout.rows || 24);
  useEffect(() => {
    const resize = () => setRows(stdout.rows || 24);
    stdout.on('resize', resize);
    return () => { stdout.off('resize', resize); };
  }, [stdout]);
  return rows;
}
