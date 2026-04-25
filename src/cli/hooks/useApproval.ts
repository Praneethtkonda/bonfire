import { useEffect, useState } from 'react';
import {
  setApprovalHandler,
  type ApprovalDecision,
  type ApprovalRequest,
} from '../../tools/index.js';

export interface PendingApproval {
  req: ApprovalRequest;
  resolve: (decision: ApprovalDecision) => void;
}

export function useApproval() {
  const [pending, setPending] = useState<PendingApproval | null>(null);

  useEffect(() => {
    setApprovalHandler(
      (req) =>
        new Promise<ApprovalDecision>((resolve) => {
          setPending({ req, resolve });
        }),
    );
    return () => setApprovalHandler(null);
  }, []);

  const decide = (decision: ApprovalDecision) => {
    if (!pending) return;
    pending.resolve(decision);
    setPending(null);
  };

  return { pending, decide };
}
