import { useEffect, useState } from 'react';
import { getThemeName, subscribeTheme } from '../theme.js';

/**
 * Re-render on theme change.
 *
 * Components import the live `theme` object directly rather than reading it
 * from context, so mutating it is invisible to React. Mounting this once at
 * the root gives Ink the state change it needs to repaint the tree.
 *
 * Note that `<Static>` transcript lines are already owned by the terminal and
 * keep their original colours — only the live region below re-themes.
 */
export function useThemeVersion(): string {
  const [name, setName] = useState(getThemeName);
  useEffect(() => subscribeTheme(() => setName(getThemeName())), []);
  return name;
}
