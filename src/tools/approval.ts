export type ApprovalRequest =
  | { tool: 'write_file' | 'edit_file'; path: string; diff: string }
  | { tool: 'shell'; command: string; cwd: string }
  | { tool: 'fetch'; url: string }
  | { tool: 'mcp'; name: string; args: unknown };

export type ApprovalDecision = 'yes' | 'no' | 'always';

export type ApprovalHandler = (req: ApprovalRequest) => Promise<ApprovalDecision>;

let handler: ApprovalHandler | null = null;

export function setApprovalHandler(fn: ApprovalHandler | null) {
  handler = fn;
}

// Tool calls in one step run in parallel, but only one prompt can be on
// screen, so prompts queue behind each other.
let queue: Promise<unknown> = Promise.resolve();

export async function requestApproval(req: ApprovalRequest): Promise<ApprovalDecision> {
  const ask = async (): Promise<ApprovalDecision> => (handler ? handler(req) : 'yes');
  const next = queue.then(ask, ask);
  queue = next.catch(() => undefined);
  return next;
}
