export type CodexTurnLifecycleDecision =
  | { kind: 'wait'; reason: CodexTurnLifecycleWaitReason }
  | { kind: 'timeout'; reason: Exclude<CodexTurnLifecycleWaitReason, 'turn_not_terminal' | 'terminal_settle'> }
  | { kind: 'complete' }
  | { kind: 'task_complete' }
  | { kind: 'partial'; previewText: string }
  | { kind: 'missing' }
  | { kind: 'interrupted' }
  | { kind: 'turn_error'; errorMessage: string }
  | { kind: 'provider_error'; errorMessage: string };

export type CodexTurnLifecycleWaitReason =
  | 'turn_not_terminal'
  | 'terminal_settle'
  | 'session_task_complete'
  | 'unsettled_assistant_activity';

export interface CodexTurnLifecycleSnapshot {
  isTerminal?: boolean;
  hasTerminalOutput?: boolean;
  isInterrupted?: boolean;
  turnError?: string | null;
  providerError?: string | null;
  shouldWaitForTerminalSettle?: boolean;
  hasTaskCompleteOutput?: boolean;
  hasTaskComplete?: boolean;
  shouldWaitForTaskComplete?: boolean;
  taskCompletionWaitExpired?: boolean;
  hasUnsettledAssistantActivity?: boolean;
  unsettledAssistantActivityWaitExpired?: boolean;
  previewText?: string;
}

export function decideCodexTurnLifecycle(
  snapshot: CodexTurnLifecycleSnapshot,
): CodexTurnLifecycleDecision {
  const {
    isTerminal = false,
    hasTerminalOutput = false,
    isInterrupted = false,
    turnError = null,
    providerError = null,
    shouldWaitForTerminalSettle = false,
    hasTaskCompleteOutput = false,
    hasTaskComplete = false,
    shouldWaitForTaskComplete = false,
    taskCompletionWaitExpired = false,
    hasUnsettledAssistantActivity = false,
    unsettledAssistantActivityWaitExpired = false,
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
  if (turnError) {
    return { kind: 'turn_error', errorMessage: turnError };
  }
  if (shouldWaitForTerminalSettle) {
    return { kind: 'wait', reason: 'terminal_settle' };
  }
  if (hasTaskCompleteOutput) {
    return { kind: 'task_complete' };
  }
  if (hasTaskComplete) {
    if (previewText) {
      return { kind: 'partial', previewText };
    }
    if (providerError) {
      return { kind: 'provider_error', errorMessage: providerError };
    }
    return { kind: 'missing' };
  }
  if (shouldWaitForTaskComplete) {
    return { kind: 'wait', reason: 'session_task_complete' };
  }
  if (taskCompletionWaitExpired) {
    return previewText
      ? { kind: 'partial', previewText }
      : { kind: 'timeout', reason: 'session_task_complete' };
  }
  if (hasUnsettledAssistantActivity) {
    return { kind: 'wait', reason: 'unsettled_assistant_activity' };
  }
  if (unsettledAssistantActivityWaitExpired) {
    return previewText
      ? { kind: 'partial', previewText }
      : { kind: 'timeout', reason: 'unsettled_assistant_activity' };
  }
  return previewText
    ? { kind: 'partial', previewText }
    : { kind: 'missing' };
}
