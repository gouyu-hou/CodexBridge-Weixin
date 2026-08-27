export type CodexTurnLifecycleDecision =
  | { kind: 'wait'; reason: string }
  | { kind: 'complete' }
  | { kind: 'partial'; previewText: string }
  | { kind: 'missing' }
  | { kind: 'interrupted' }
  | { kind: 'provider_error'; errorMessage: string };

export interface CodexTurnLifecycleSnapshot {
  isTerminal?: boolean;
  hasTerminalOutput?: boolean;
  isInterrupted?: boolean;
  providerError?: string | null;
  shouldWaitForTerminalSettle?: boolean;
  hasTaskComplete?: boolean;
  shouldWaitForTaskComplete?: boolean;
  hasUnsettledAssistantActivity?: boolean;
  previewText?: string;
}

export function decideCodexTurnLifecycle(
  snapshot: CodexTurnLifecycleSnapshot,
): CodexTurnLifecycleDecision {
  const {
    isTerminal = false,
    hasTerminalOutput = false,
    isInterrupted = false,
    providerError = null,
    shouldWaitForTerminalSettle = false,
    hasTaskComplete = false,
    shouldWaitForTaskComplete = false,
    hasUnsettledAssistantActivity = false,
    previewText = '',
  } = snapshot;
  if (!isTerminal) {
    return { kind: 'wait', reason: 'turn_not_terminal' };
  }
  if (hasTerminalOutput) {
    return { kind: 'complete' };
  }
  if (isInterrupted) {
    return { kind: 'interrupted' };
  }
  if (shouldWaitForTerminalSettle) {
    return { kind: 'wait', reason: 'terminal_settle' };
  }
  if (hasTaskComplete && providerError) {
    return { kind: 'provider_error', errorMessage: providerError };
  }
  if (hasTaskComplete) {
    return previewText
      ? { kind: 'partial', previewText }
      : { kind: 'missing' };
  }
  if (shouldWaitForTaskComplete) {
    return { kind: 'wait', reason: 'session_task_complete' };
  }
  if (hasUnsettledAssistantActivity) {
    return { kind: 'wait', reason: 'unsettled_assistant_activity' };
  }
  return previewText
    ? { kind: 'partial', previewText }
    : { kind: 'missing' };
}
