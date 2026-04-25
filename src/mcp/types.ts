export interface OpenedClient {
  client: { close: () => Promise<void> };
  tools: Record<string, unknown>;
}

export interface LoadedMcp {
  tools: Record<string, unknown>;
  close: () => Promise<void>;
}
