import React from 'react';
import { Static, Text } from 'ink';
import type { Line } from '../types.js';
import { assertNever } from '../types.js';
import { ToolLine } from './ToolLine.js';
import { ResultLine } from './ResultLine.js';

export function Transcript({ lines }: { lines: Line[] }) {
  return (
    <Static items={lines}>
      {(l: Line, i: number) => {
        switch (l.kind) {
          case 'user':
            return (
              <Text key={i}>
                <Text color="green" bold>
                  ❯{' '}
                </Text>
                {l.text}
              </Text>
            );
          case 'assistant':
            return (
              <Text key={i} color="white">
                {l.text}
              </Text>
            );
          case 'tool':
            return <ToolLine key={i} name={l.name} args={l.args} />;
          case 'tool-result':
            return <ResultLine key={i} name={l.name} result={l.result} />;
          case 'error':
            return (
              <Text key={i} color="red">
                ! {l.text}
              </Text>
            );
          default:
            return assertNever(l);
        }
      }}
    </Static>
  );
}
