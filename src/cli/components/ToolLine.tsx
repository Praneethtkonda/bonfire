import React from 'react';
import { Text } from 'ink';
import { truncate } from '../util.js';

export function ToolLine({ name, args }: { name: string; args: unknown }) {
  const summary = truncate(JSON.stringify(args));
  return (
    <Text color="cyan">
      {'  '}● {name}({summary})
    </Text>
  );
}
