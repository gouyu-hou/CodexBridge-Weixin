import {
  buildApprovalResponseResult,
  createApprovedExecution,
} from './codex_app_protocol.js';
import type {
  ApprovedExecution,
  PendingApproval,
} from './codex_app_protocol.js';
import type { ProviderApprovalRequest } from './provider.js';

export class CodexAppApprovalState {
  private readonly pendingApprovals: Map<string, PendingApproval>;

  private readonly now: () => number;

  constructor({ now = () => Date.now() }: { now?: () => number } = {}) {
    this.pendingApprovals = new Map();
    this.now = now;
  }

  set(pending: PendingApproval): void {
    this.pendingApprovals.set(pending.rpcId, pending);
  }

  get(requestId: string | number): PendingApproval | null {
    return this.pendingApprovals.get(String(requestId)) ?? null;
  }

  list({
    threadId = null,
    turnId = null,
  }: {
    threadId?: string | null;
    turnId?: string | null;
  } = {}): ProviderApprovalRequest[] {
    return [...this.pendingApprovals.values()]
      .map((entry) => entry.request)
      .filter((entry) => {
        if (threadId && entry.threadId !== threadId) {
          return false;
        }
        if (turnId && entry.turnId !== turnId) {
          return false;
        }
        return true;
      });
  }

  prepare(
    requestId: string | number,
    option: 1 | 2 | 3,
  ): {
    pending: PendingApproval;
    result: unknown;
    approvedExecution: ApprovedExecution | null;
  } {
    const pending = this.get(requestId);
    if (!pending) {
      throw new Error(`Unknown approval request: ${requestId}`);
    }
    return {
      pending,
      result: buildApprovalResponseResult(pending, option),
      approvedExecution: createApprovedExecution(pending, option, this.now()),
    };
  }

  remove(requestId: string | number): void {
    this.pendingApprovals.delete(String(requestId));
  }

  clear(): void {
    this.pendingApprovals.clear();
  }
}
