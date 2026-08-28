import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decideCodexTurnLifecycle,
  type CodexTurnLifecycleSnapshot,
} from '../src/codex_app_turn_lifecycle.js';

const baseSnapshot: CodexTurnLifecycleSnapshot = {
  isTerminal: true,
  hasTerminalOutput: false,
  isInterrupted: false,
  turnError: null,
  providerError: null,
  shouldWaitForTerminalSettle: false,
  hasTaskCompleteOutput: false,
  hasTaskComplete: false,
  shouldWaitForTaskComplete: false,
  taskCompletionWaitExpired: false,
  hasUnsettledAssistantActivity: false,
  unsettledAssistantActivityWaitExpired: false,
  previewText: '',
};

test('turn lifecycle classifies normalized terminal snapshots', () => {
  const cases: Array<{
    name: string;
    snapshot: Partial<CodexTurnLifecycleSnapshot>;
    expected: unknown;
  }> = [
    {
      name: 'terminal output completes and allows cleanup',
      snapshot: { hasTerminalOutput: true },
      expected: { kind: 'complete' },
    },
    {
      name: 'interrupted terminal turn remains interrupted',
      snapshot: { isInterrupted: true },
      expected: { kind: 'interrupted' },
    },
    {
      name: 'terminal output takes precedence over every lower-priority state',
      snapshot: {
        hasTerminalOutput: true,
        isInterrupted: true,
        turnError: 'turn failed',
        shouldWaitForTerminalSettle: true,
        hasTaskCompleteOutput: true,
        hasTaskComplete: true,
        providerError: 'session failed',
        shouldWaitForTaskComplete: true,
        hasUnsettledAssistantActivity: true,
        previewText: 'preview',
      },
      expected: { kind: 'complete' },
    },
    {
      name: 'interruption takes precedence over the terminal turn error',
      snapshot: { isInterrupted: true, turnError: 'turn failed' },
      expected: { kind: 'interrupted' },
    },
    {
      name: 'terminal turn errors precede settling and task completion',
      snapshot: {
        turnError: 'turn failed',
        shouldWaitForTerminalSettle: true,
        hasTaskCompleteOutput: true,
      },
      expected: { kind: 'turn_error', errorMessage: 'turn failed' },
    },
    {
      name: 'session provider error is returned after task completion',
      snapshot: {
        hasTaskComplete: true,
        providerError: 'Codex subscription credits are exhausted.',
      },
      expected: {
        kind: 'provider_error',
        errorMessage: 'Codex subscription credits are exhausted.',
      },
    },
    {
      name: 'commentary-only task completion is partial',
      snapshot: { hasTaskComplete: true, previewText: 'I am checking that now.' },
      expected: { kind: 'partial', previewText: 'I am checking that now.' },
    },
    {
      name: 'task completion keeps preview text ahead of a session provider error',
      snapshot: {
        hasTaskComplete: true,
        providerError: 'Codex subscription credits are exhausted.',
        previewText: 'I am checking that now.',
      },
      expected: { kind: 'partial', previewText: 'I am checking that now.' },
    },
    {
      name: 'empty task completion is missing',
      snapshot: { hasTaskComplete: true },
      expected: { kind: 'missing' },
    },
    {
      name: 'terminal materialization remains a local wait',
      snapshot: { shouldWaitForTerminalSettle: true },
      expected: { kind: 'wait', reason: 'terminal_settle' },
    },
    {
      name: 'materialized session task output completes',
      snapshot: { hasTaskCompleteOutput: true },
      expected: { kind: 'task_complete' },
    },
    {
      name: 'missing session task completion remains a local wait',
      snapshot: { shouldWaitForTaskComplete: true },
      expected: { kind: 'wait', reason: 'session_task_complete' },
    },
    {
      name: 'expired session task completion returns an available preview',
      snapshot: { taskCompletionWaitExpired: true, previewText: 'task preview' },
      expected: { kind: 'partial', previewText: 'task preview' },
    },
    {
      name: 'expired session task completion without a preview times out',
      snapshot: { taskCompletionWaitExpired: true },
      expected: { kind: 'timeout', reason: 'session_task_complete' },
    },
    {
      name: 'expired unsettled activity returns an available preview',
      snapshot: { unsettledAssistantActivityWaitExpired: true, previewText: 'activity preview' },
      expected: { kind: 'partial', previewText: 'activity preview' },
    },
    {
      name: 'expired unsettled activity without a preview times out',
      snapshot: { unsettledAssistantActivityWaitExpired: true },
      expected: { kind: 'timeout', reason: 'unsettled_assistant_activity' },
    },
  ];

  for (const { name, snapshot, expected } of cases) {
    assert.deepEqual(decideCodexTurnLifecycle({ ...baseSnapshot, ...snapshot }), expected, name);
  }
});

test('turn lifecycle keeps non-terminal and unsettled terminal snapshots waiting', () => {
  assert.deepEqual(
    decideCodexTurnLifecycle({ ...baseSnapshot, isTerminal: false }),
    { kind: 'wait', reason: 'turn_not_terminal' },
  );
  assert.deepEqual(
    decideCodexTurnLifecycle({ ...baseSnapshot, hasUnsettledAssistantActivity: true }),
    { kind: 'wait', reason: 'unsettled_assistant_activity' },
  );
});
