import type { ModelMessage } from 'ai';

/** Minimal session metadata shown in /sessions list. */
export interface SessionMeta {
  id: string;
  cwd: string;
  provider: string;
  createdAt: number;
  updatedAt: number;
  turnCount: number;
  lastMessage: string;
}

/** Full session — metadata + history. */
export interface Session {
  version: 1;
  id: string;
  cwd: string;
  provider: string;
  createdAt: number;
  updatedAt: number;
  history: ModelMessage[];
}
