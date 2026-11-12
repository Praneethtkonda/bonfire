import React from 'react';
import { Text } from 'ink';
import { BRAND_GRADIENT } from '../theme.js';

/** The bonfire block mark. */
export const LOGO_LINES = [
  '██████╗  ██████╗ ███╗   ██╗███████╗██╗██████╗ ███████╗',
  '██╔══██╗██╔═══██╗████╗  ██║██╔════╝██║██╔══██╗██╔════╝',
  '██████╔╝██║   ██║██╔██╗ ██║█████╗  ██║██████╔╝█████╗',
  '██╔══██╗██║   ██║██║╚██╗██║██╔══╝  ██║██╔══██╗██╔══╝',
  '██████╔╝╚██████╔╝██║ ╚████║██║     ██║██║  ██║███████╗',
  '╚═════╝  ╚═════╝ ╚═╝  ╚═══╝╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝',
];

export const LOGO_WIDTH = Math.max(...LOGO_LINES.map((l) => [...l].length));

function hexPair(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/**
 * Colour of column `i` of `width` on the red-orange → amber fire gradient
 * (truncating linear interpolation).
 */
export function gradientHex(i: number, width: number): string {
  const t = i / Math.max(width - 1, 1);
  const [r1, g1, b1] = hexPair(BRAND_GRADIENT.from);
  const [r2, g2, b2] = hexPair(BRAND_GRADIENT.to);
  const mix = (a: number, b: number) => Math.trunc(a * (1 - t) + b * t);
  return `#${[mix(r1, r2), mix(g1, g2), mix(b1, b2)]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`;
}

/** Colour is off for NO_COLOR, a dumb terminal, or output that isn't a TTY. */
export function logoColorEnabled(
  env: NodeJS.ProcessEnv = process.env,
  isTTY: boolean = Boolean(process.stdout.isTTY),
): boolean {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return false;
  if (env.TERM === 'dumb') return false;
  return isTTY;
}

function GradientLine({ line }: { line: string }) {
  const chars = [...line];
  return (
    <Text>
      {chars.map((ch, i) =>
        ch === ' ' ? (
          <React.Fragment key={i}> </React.Fragment>
        ) : (
          <Text key={i} color={gradientHex(i, LOGO_WIDTH)} bold>
            {ch}
          </Text>
        ),
      )}
    </Text>
  );
}

/**
 * The bonfire mark. Falls back to a one-line `◆ Bonfire` on terminals too
 * narrow for the block letters, and drops the gradient when colour is off.
 */
export function Logo({ columns, color }: { columns: number; color: boolean }) {
  if (columns < LOGO_WIDTH + 2) {
    return color ? (
      <Text>
        <Text color={BRAND_GRADIENT.from} bold>
          ◆{' '}
        </Text>
        <Text bold>Bonfire</Text>
      </Text>
    ) : (
      <Text>◆ Bonfire</Text>
    );
  }
  return (
    <>
      {LOGO_LINES.map((line, i) =>
        color ? <GradientLine key={i} line={line} /> : <Text key={i}>{line}</Text>,
      )}
    </>
  );
}

