import { useEffect, useState } from 'react';
import { describeProvider } from '../../agent/index.js';

export function useProvider(refreshKey?: number) {
  const [label, setLabel] = useState('…');
  useEffect(() => {
    describeProvider()
      .then(setLabel)
      .catch(() => setLabel('unknown'));
  }, [refreshKey]);
  return label;
}
