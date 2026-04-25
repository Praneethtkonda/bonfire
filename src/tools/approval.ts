export type ApprovalRequest =
  | { tool: 'write_file' | 'edit_file'; path: string; diff: string }
  | { tool: 'shell'; command: string; cwd: string }
  | { tool: 'mcp'; name: string; args: unknown };

export type ApprovalDecision = 'yes' | 'no' | 'always';

export type ApprovalHandler = (req: ApprovalRequest) => Promise<ApprovalDecision>;

let handler: ApprovalHandler | null = null;

export function setApprovalHandler(fn: ApprovalHandler | null) {
  handler = fn;
}

export async function requestApproval(req: ApprovalRequest): Promise<ApprovalDecision> {
  if (!handler) return 'yes';
  return handler(req);
}
