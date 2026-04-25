import { useEffect, useState } from 'react';
import { describeProvider } from '../../agent/index.js';

export function useProvider() {
  const [label, setLabel] = useState('…');
  useEffect(() => {
    describeProvider()
      .then(setLabel)
      .catch(() => setLabel('unknown'));
  }, []);
  return label;
}
