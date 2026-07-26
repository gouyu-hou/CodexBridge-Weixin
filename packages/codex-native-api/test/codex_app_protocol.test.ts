import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appServerBucketName,
  appServerUsageWindow,
  appServerUsageWindows,
  buildApprovalResponseResult,
  buildLegacyReviewDecision,
  buildV2CommandApprovalDecision,
  buildV2FileChangeApprovalDecision,
  buildV2PermissionsApprovalDecision,
  classifyApprovedExecutionSignal,
  createApprovedExecution,
  extractStructuredString,
  extractStructuredText,
  extractTextCandidate,
  formatConfigKeyPath,
  isAgentDeltaNotificationMethod,
  isThreadLevelApprovedExecutionSignal,
  isTurnTerminal,
  mapAppInfo,
  mapAppServerRateLimits,
  mapCommandExecutionApprovalRequest,
  mapFileChangeApprovalRequest,
  mapLegacyApplyPatchApprovalRequest,
  mapLegacyExecApprovalRequest,
  mapMcpServerStatus,
  mapModel,
  mapPendingApproval,
  mapPermissionsApprovalRequest,
  mapPluginAppSummary,
  mapPluginDetail,
  mapPluginLoadError,
  mapPluginMarketplace,
  mapPluginSkillSummary,
  mapPluginSummary,
  mapSandboxPolicy,
  mapSkillErrorInfo,
  mapSkillMetadata,
  mapSkillToolDependency,
  mapThread,
  mapThreadGoal,
  mapThreadSummary,
  mapTurn,
  mapTurnItem,
  mergeModelCatalog,
  normalizeApprovalDecisionKey,
  normalizeFeatureList,
  normalizeNullableString,
  normalizeOptionalBoolean,
  normalizeProtocolTimestamp,
  normalizeStringList,
  normalizeTurnStatusKey,
  summarizeApprovedExecution,
  summarizeApprovedExecutionSignal,
  truncateDebugText,
} from '../src/codex_app_protocol.js';

test('protocol string and boolean normalization preserves current client behavior', () => {
  assert.equal(normalizeNullableString('  value  '), 'value');
  assert.equal(normalizeNullableString('   '), null);
  assert.equal(normalizeNullableString(null), null);
  assert.deepEqual(normalizeStringList([' one ', '', null, 2]), ['one', '2']);
  assert.deepEqual(normalizeStringList('one'), []);
  assert.equal(normalizeOptionalBoolean(true), true);
  assert.equal(normalizeOptionalBoolean(false), false);
  assert.equal(normalizeOptionalBoolean(1), null);
});

test('formatConfigKeyPath quotes and escapes non-identifier segments', () => {
  assert.equal(formatConfigKeyPath(['features', 'fast_mode']), 'features.fast_mode');
  assert.equal(
    formatConfigKeyPath(['profiles', 'a.b', 'say"hello', 'c\\d']),
    'profiles."a.b"."say\\"hello"."c\\\\d"',
  );
});

test('normalizeFeatureList trims and stably deduplicates feature names', () => {
  assert.deepEqual(
    normalizeFeatureList([' fast ', '', 'fast', 'apps', ' fast ']),
    ['fast', 'apps'],
  );
});

test('normalizeProtocolTimestamp accepts seconds and milliseconds', () => {
  assert.equal(normalizeProtocolTimestamp(null), 0);
  assert.equal(normalizeProtocolTimestamp(-1), 0);
  assert.equal(normalizeProtocolTimestamp(1_700_000_000), 1_700_000_000_000);
  assert.equal(normalizeProtocolTimestamp(1_700_000_000_000), 1_700_000_000_000);
});

test('normalizeTurnStatusKey ignores separators and casing', () => {
  assert.equal(normalizeTurnStatusKey(' In_Progress '), 'inprogress');
  assert.equal(normalizeTurnStatusKey('TURN-COMPLETED'), 'turncompleted');
  assert.equal(normalizeTurnStatusKey(null), '');
});

test('parity: boxed primitives coerce through String/Number like current clients', () => {
  assert.equal(normalizeNullableString(new String('  boxed  ')), 'boxed');
  assert.equal(normalizeNullableString(new Number(42)), '42');
  assert.deepEqual(normalizeStringList([new String(' one '), new Number(2)]), ['one', '2']);
  assert.equal(normalizeOptionalBoolean(new Boolean(true)), null);
  assert.equal(normalizeProtocolTimestamp(new Number(1_700_000_000)), 1_700_000_000_000);
  assert.equal(normalizeTurnStatusKey(new String(' Turn_Done ')), 'turndone');
});

test('parity: whitespace-only inputs collapse to empty results everywhere', () => {
  assert.equal(normalizeNullableString('\t\n  '), null);
  assert.deepEqual(normalizeStringList(['   ', '\t', '\n']), []);
  assert.deepEqual(normalizeFeatureList(['   ', '\t\n']), []);
  assert.equal(normalizeTurnStatusKey('  \t '), '');
  assert.equal(formatConfigKeyPath(['  ']), '""');
});

test('parity: feature deduplication keeps first occurrence order with unicode names', () => {
  assert.deepEqual(
    normalizeFeatureList(['深度检索', ' 深度检索 ', 'apps', '深度检索', 42 as unknown as string]),
    ['深度检索', 'apps'],
  );
});

test('parity: timestamps below the seconds threshold scale to milliseconds', () => {
  assert.equal(normalizeProtocolTimestamp(0.5), 500);
  assert.equal(normalizeProtocolTimestamp(999.5), 999_500);
  assert.equal(normalizeProtocolTimestamp(9_999_999_999), 9_999_999_999_000);
  assert.equal(normalizeProtocolTimestamp(10_000_000_000), 10_000_000_000);
  assert.equal(normalizeProtocolTimestamp('1700000000'), 1_700_000_000_000);
  assert.equal(normalizeProtocolTimestamp(true), 1000);
  assert.equal(normalizeProtocolTimestamp(Number.NaN), 0);
  assert.equal(normalizeProtocolTimestamp(Number.POSITIVE_INFINITY), 0);
  assert.equal(normalizeProtocolTimestamp('not-a-number'), 0);
});

test('parity: unicode and mixed config segments quote exactly like current clients', () => {
  assert.equal(formatConfigKeyPath(['模型', 'fast_mode']), '"模型".fast_mode');
  assert.equal(formatConfigKeyPath(['a b', 'c.d']), '"a b"."c.d"');
  assert.equal(formatConfigKeyPath([' padded ', 'ok_1']), 'padded.ok_1');
  assert.equal(formatConfigKeyPath([]), '');
});

test('mapPendingApproval maps v2 and legacy approval methods', () => {
  const v2 = mapPendingApproval({
    id: 7,
    method: 'item/commandExecution/requestApproval',
    params: {
      threadId: 't1',
      turnId: ' turn ',
      command: ' ls ',
      availableDecisions: ['accept', { acceptForSession: {} }],
    },
  });
  assert.equal(v2?.transportKind, 'v2_command');
  assert.equal(v2?.rpcId, '7');
  assert.equal(v2?.rpcResponseId, 7);
  assert.equal(v2?.request.kind, 'command');
  assert.equal(v2?.request.threadId, 't1');
  assert.equal(v2?.request.turnId, 'turn');
  assert.deepEqual(v2?.request.availableDecisionKeys, ['accept', 'acceptForSession']);
  const fileChange = mapPendingApproval({
    id: 'fc',
    method: 'item/fileChange/requestApproval',
    params: { threadId: 't', grantRoot: ' /root ' },
  });
  assert.equal(fileChange?.transportKind, 'v2_file_change');
  assert.equal(fileChange?.rpcResponseId, 'fc');
  assert.equal(fileChange?.request.grantRoot, '/root');
  const permissions = mapPendingApproval({
    id: 'p',
    method: 'item/permissions/requestApproval',
    params: { threadId: 't', permissions: { network: { enabled: false } } },
  });
  assert.equal(permissions?.transportKind, 'v2_permissions');
  assert.equal(permissions?.request.networkPermission, false);
  const legacyExec = mapPendingApproval({
    id: 'e',
    method: 'execCommandApproval',
    params: { conversationId: 'c', command: ['echo', ' hi ', ''], approvalId: ' a1 ' },
  });
  assert.equal(legacyExec?.transportKind, 'legacy_exec');
  assert.equal(legacyExec?.request.threadId, 'c');
  assert.equal(legacyExec?.request.command, 'echo hi');
  assert.equal(legacyExec?.request.itemId, 'a1');
  const legacyPatch = mapPendingApproval({
    id: 'ap',
    method: 'applyPatchApproval',
    params: { conversationId: 'c1', callId: 'call', fileChanges: { 'a.ts': {}, '': {} } },
  });
  assert.equal(legacyPatch?.transportKind, 'legacy_apply_patch');
  assert.deepEqual(legacyPatch?.request.fileChanges, ['a.ts']);
  assert.equal(mapPendingApproval({ id: 'x', method: 'unknown/method' }), null);
  assert.equal(mapPendingApproval({ method: 'execCommandApproval' }), null);
  assert.equal(mapPendingApproval({ id: 'x', method: '   ' }), null);
});

test('command approval request normalizes permissions and exec policy amendments', () => {
  const request = mapCommandExecutionApprovalRequest('r1', {
    threadId: 't',
    reason: '  why  ',
    cwd: '',
    command: ' run ',
    availableDecisions: ['accept', 'decline', { acceptWithExecpolicyAmendment: {} }],
    proposedExecpolicyAmendment: [' allow ', '', null],
    additionalPermissions: { network: { enabled: true }, fileSystem: { read: [' a '], write: [] } },
  });
  assert.equal(request.reason, 'why');
  assert.equal(request.cwd, null);
  assert.equal(request.command, 'run');
  assert.deepEqual(request.availableDecisionKeys, ['accept', 'decline', 'acceptWithExecpolicyAmendment']);
  assert.deepEqual(request.execPolicyAmendment, ['allow']);
  assert.equal(request.networkPermission, true);
  assert.deepEqual(request.fileReadPermissions, ['a']);
  assert.deepEqual(request.fileWritePermissions, []);
  const bare = mapCommandExecutionApprovalRequest('r2', {});
  assert.equal(bare.threadId, '');
  assert.deepEqual(bare.availableDecisionKeys, []);
  assert.equal(bare.execPolicyAmendment, null);
  assert.deepEqual(mapFileChangeApprovalRequest('f', {}).availableDecisionKeys, ['accept', 'acceptForSession', 'decline']);
  assert.deepEqual(mapPermissionsApprovalRequest('p', {}).availableDecisionKeys, ['accept', 'acceptForSession', 'decline']);
  assert.deepEqual(mapLegacyExecApprovalRequest('l', {}).availableDecisionKeys, ['accept', 'acceptForSession', 'decline']);
  assert.equal(mapLegacyExecApprovalRequest('l', { command: 'not-array' }).command, null);
  assert.deepEqual(mapLegacyApplyPatchApprovalRequest('a', {}).fileChanges, []);
});

test('v2 command decision honors available decision keys', () => {
  assert.equal(buildV2CommandApprovalDecision({ availableDecisionKeys: [] } as any, 1), 'accept');
  assert.deepEqual(
    buildV2CommandApprovalDecision({
      execPolicyAmendment: ['x'],
      availableDecisionKeys: ['acceptWithExecpolicyAmendment'],
    } as any, 2),
    { acceptWithExecpolicyAmendment: { execpolicy_amendment: ['x'] } },
  );
  assert.equal(
    buildV2CommandApprovalDecision({ availableDecisionKeys: ['acceptForSession'] } as any, 2),
    'acceptForSession',
  );
  assert.throws(() => buildV2CommandApprovalDecision({ availableDecisionKeys: [] } as any, 2));
  assert.equal(buildV2CommandApprovalDecision({ availableDecisionKeys: ['decline'] } as any, 3), 'decline');
  assert.equal(buildV2CommandApprovalDecision({ availableDecisionKeys: ['cancel'] } as any, 3), 'cancel');
  assert.throws(() => buildV2CommandApprovalDecision({ availableDecisionKeys: [] } as any, 3));
  assert.equal(buildV2FileChangeApprovalDecision(1), 'accept');
  assert.equal(buildV2FileChangeApprovalDecision(2), 'acceptForSession');
  assert.equal(buildV2FileChangeApprovalDecision(3), 'decline');
  assert.equal(buildLegacyReviewDecision(1), 'approved');
  assert.equal(buildLegacyReviewDecision(2), 'approved_for_session');
  assert.equal(buildLegacyReviewDecision(3), 'denied');
});

test('approval response result selects transport-specific decisions', () => {
  const request = { availableDecisionKeys: ['decline'] } as any;
  assert.deepEqual(
    buildApprovalResponseResult({ transportKind: 'v2_command', request } as any, 3),
    { decision: 'decline' },
  );
  assert.deepEqual(
    buildApprovalResponseResult({ transportKind: 'v2_file_change', request } as any, 2),
    { decision: 'acceptForSession' },
  );
  assert.deepEqual(
    buildApprovalResponseResult({ transportKind: 'v2_permissions', request: { networkPermission: true } } as any, 2),
    { permissions: { network: { enabled: true } }, scope: 'session' },
  );
  assert.deepEqual(
    buildV2PermissionsApprovalDecision({
      networkPermission: null,
      fileReadPermissions: ['r'],
      fileWritePermissions: [],
    } as any, 1),
    { permissions: { fileSystem: { read: ['r'], write: [] } }, scope: 'turn' },
  );
  assert.deepEqual(
    buildV2PermissionsApprovalDecision({ networkPermission: true } as any, 3),
    { permissions: {}, scope: 'turn' },
  );
  assert.deepEqual(
    buildApprovalResponseResult({ transportKind: 'legacy_exec', request } as any, 1),
    { decision: 'approved' },
  );
  assert.deepEqual(
    buildApprovalResponseResult({ transportKind: 'legacy_apply_patch', request } as any, 2),
    { decision: 'approved_for_session' },
  );
  assert.throws(() => buildApprovalResponseResult({ transportKind: 'other', request } as any, 1));
});

test('approved execution tracking state derives from the pending approval', () => {
  const pending = {
    rpcId: 'r',
    request: { kind: 'command', threadId: 't', turnId: 'u', itemId: 'i', command: 'ls' },
  } as any;
  assert.equal(createApprovedExecution(pending, 3, 5), null);
  const entry = createApprovedExecution(pending, 1, 42);
  assert.deepEqual(entry, {
    requestId: 'r',
    kind: 'command',
    threadId: 't',
    turnId: 'u',
    itemId: 'i',
    command: 'ls',
    approvedAt: 42,
    lastSignalAt: 42,
    lastSignalKind: 'approval_response_sent',
    signalCount: 0,
    completedAt: null,
    lastObservedTurnSnapshotKey: null,
  });
  const noCommand = createApprovedExecution({
    rpcId: 'r2',
    request: { kind: 'file_change', threadId: 't', turnId: null, itemId: null },
  } as any, 2, 1);
  assert.equal(noCommand?.command, null);
});

test('approval decision keys and execution signals normalize consistently', () => {
  assert.equal(normalizeApprovalDecisionKey(' accept '), 'accept');
  assert.equal(normalizeApprovalDecisionKey({ acceptForSession: {} }), 'acceptForSession');
  assert.equal(normalizeApprovalDecisionKey({ a: 1, b: 2 }), '');
  assert.equal(normalizeApprovalDecisionKey(7), '');
  assert.equal(classifyApprovedExecutionSignal('item/started'), 'item_started');
  assert.equal(classifyApprovedExecutionSignal('item/completed'), 'item_completed');
  assert.equal(classifyApprovedExecutionSignal('thread.status_changed'), 'thread_status_changed');
  assert.equal(classifyApprovedExecutionSignal('turn/started'), 'turn_started');
  assert.equal(classifyApprovedExecutionSignal('turn.completed'), 'turn_completed');
  assert.equal(classifyApprovedExecutionSignal('serverRequestResolved'), 'server_request_resolved');
  assert.equal(classifyApprovedExecutionSignal('item/agentMessage/delta'), 'assistant_delta');
  assert.equal(classifyApprovedExecutionSignal('unknown'), null);
  assert.equal(isThreadLevelApprovedExecutionSignal('thread_status_changed'), true);
  assert.equal(isThreadLevelApprovedExecutionSignal('turn_completed'), true);
  assert.equal(isThreadLevelApprovedExecutionSignal('server_request_resolved'), true);
  assert.equal(isThreadLevelApprovedExecutionSignal('item_started'), false);
});

test('approved execution summaries expose a bounded command preview', () => {
  const entry = {
    requestId: 'r',
    kind: 'command',
    threadId: 't',
    turnId: null,
    itemId: null,
    command: 'x'.repeat(200),
    approvedAt: 1,
    lastSignalAt: 2,
    lastSignalKind: 'k',
    signalCount: 3,
    completedAt: null,
  } as any;
  const summary = summarizeApprovedExecution(entry);
  assert.equal(summary.commandPreview, `${'x'.repeat(120)}...`);
  assert.equal(summary.signalCount, 3);
  assert.equal(summary.completedAt, null);
  const signal = summarizeApprovedExecutionSignal(entry, 'turn_completed');
  assert.equal(signal.signalKind, 'turn_completed');
  assert.equal(signal.commandPreview, `${'x'.repeat(120)}...`);
});

test('thread and model mapping preserves current shapes', () => {
  assert.deepEqual(mapThreadSummary({ id: 9, name: '', cwd: null, updatedAt: 1_700_000_000, preview: 'p' }), {
    threadId: '9',
    title: null,
    cwd: null,
    updatedAt: 1_700_000_000_000,
    preview: 'p',
  });
  const thread = mapThread({
    id: 't',
    name: 'n',
    cwd: '/w',
    path: '/p',
    updatedAt: 0,
    preview: 1,
    turns: [{ id: 'u', status: { text: 'done' }, items: [{ type: 'agentMessage', text: 'hi' }] }],
  }, true);
  assert.equal(thread.title, 'n');
  assert.equal(thread.path, '/p');
  assert.equal(thread.preview, '');
  assert.equal(thread.turns.length, 1);
  assert.equal(thread.turns[0].status, 'done');
  assert.equal(thread.turns[0].items[0].text, 'hi');
  assert.deepEqual(mapThread({ id: 't', turns: [{}] }, false).turns, []);
  assert.deepEqual(mapTurn({}), { id: '', status: null, error: null, items: [] });
  assert.deepEqual(mapTurnItem({ savedPath: ' /s ', result: { text: 'ok' } }), {
    type: 'unknown',
    role: null,
    phase: null,
    text: null,
    savedPath: ' /s ',
    result: 'ok',
  });
  const model = mapModel({
    id: 'm',
    model: 'gpt',
    displayName: '',
    description: null,
    isDefault: 0,
    supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 7 }],
    defaultReasoningEffort: 'low',
  });
  assert.deepEqual(model, {
    id: 'm',
    model: 'gpt',
    displayName: 'gpt',
    description: '',
    isDefault: false,
    supportedReasoningEfforts: ['low'],
    defaultReasoningEffort: 'low',
  });
});

test('thread goals require a non-empty objective', () => {
  assert.equal(mapThreadGoal(null), null);
  assert.equal(mapThreadGoal({ objective: '   ' }), null);
  assert.deepEqual(mapThreadGoal({ thread_id: 't', objective: ' goal ', tokenBudget: 10, tokensUsed: 'x' }), {
    threadId: 't',
    objective: 'goal',
    status: 'active',
    tokenBudget: 10,
    tokensUsed: null,
    timeUsedSeconds: null,
    createdAt: null,
    updatedAt: null,
  });
});

test('model catalog merge overlays defaults deterministically', () => {
  const base = [
    { model: 'a', isDefault: true, description: 'base-a' },
    { model: 'b', isDefault: false },
  ];
  assert.equal(mergeModelCatalog(base, []), base);
  const merged = mergeModelCatalog(base, [{ model: 'a', isDefault: false, displayName: 'A' }]);
  assert.deepEqual(merged, [
    { model: 'a', isDefault: true, description: 'base-a', displayName: 'A' },
    { model: 'b', isDefault: false },
  ]);
  const withDefault = mergeModelCatalog(base, [{ model: 'c', isDefault: true }]);
  assert.deepEqual(withDefault.map((entry) => [entry.model, entry.isDefault]), [
    ['c', true],
    ['a', false],
    ['b', false],
  ]);
});

test('sandbox policies and terminal turn statuses match current clients', () => {
  assert.deepEqual(mapSandboxPolicy('read-only'), { type: 'readOnly' });
  assert.deepEqual(mapSandboxPolicy('danger-full-access'), { type: 'dangerFullAccess' });
  assert.deepEqual(mapSandboxPolicy('anything-else'), { type: 'workspaceWrite' });
  assert.equal(isTurnTerminal('Completed'), true);
  assert.equal(isTurnTerminal('TIMED_OUT'), true);
  assert.equal(isTurnTerminal(' canceled '), true);
  assert.equal(isTurnTerminal('in_progress'), false);
  assert.equal(isTurnTerminal(null), false);
});

test('app-server rate limits normalize buckets, credits, and plan', () => {
  assert.equal(mapAppServerRateLimits(null), null);
  assert.equal(mapAppServerRateLimits(undefined), null);
  const report = mapAppServerRateLimits({
    rateLimitsByLimitId: {
      b: { limitId: 'b', planType: ' plus ', primary: { usedPercent: 150.4, windowDurationMins: 2, resetsAt: 0 } },
      a: {
        limitName: ' Weekly ',
        secondary: { usedPercent: -5, windowDurationMins: null, resetsAt: 0 },
        credits: { hasCredits: true, unlimited: false, balance: ' 10 ' },
      },
    },
  });
  assert.equal(report?.plan, 'plus');
  assert.deepEqual(report?.credits, { hasCredits: true, unlimited: false, balance: '10' });
  assert.deepEqual(report?.buckets.map((bucket) => [bucket.name, bucket.limitReached, bucket.allowed]), [
    ['Weekly', false, true],
    ['b', true, false],
  ]);
  assert.equal(report?.buckets[1]?.windows[0]?.usedPercent, 100);
  const single = mapAppServerRateLimits({ rateLimits: { primary: { usedPercent: 10 } } });
  assert.equal(single?.buckets.length, 1);
  assert.equal(single?.buckets[0]?.name, 'Rate limit');
  const empty = mapAppServerRateLimits({ rateLimits: {} });
  assert.deepEqual(empty?.buckets, []);
});

test('app-server usage windows clamp and convert like current clients', () => {
  assert.deepEqual(appServerUsageWindow('Primary', { usedPercent: 33.4, windowDurationMins: 10.2, resetsAt: 0 }), {
    name: 'Primary',
    usedPercent: 33,
    windowSeconds: 612,
    resetAfterSeconds: 0,
    resetAtUnix: 0,
  });
  assert.deepEqual(appServerUsageWindows({}), []);
  assert.equal(appServerUsageWindows({ primary: { usedPercent: 1 }, secondary: { usedPercent: 2 } }).length, 2);
  assert.equal(appServerBucketName({ limitName: ' X ' }), 'X');
  assert.equal(appServerBucketName({ limitId: 'id' }), 'id');
  assert.equal(appServerBucketName({}), 'Rate limit');
});

test('skill metadata mapping filters incomplete records and dependencies', () => {
  assert.equal(mapSkillToolDependency({ type: 'mcp', value: '' }), null);
  assert.deepEqual(mapSkillToolDependency({ type: ' mcp ', value: ' v ' }), {
    type: 'mcp',
    value: 'v',
    command: null,
    description: null,
    transport: null,
    url: null,
  });
  assert.equal(mapSkillMetadata({ name: 'n', description: 'd', path: '/p' }), null);
  const skill = mapSkillMetadata({
    name: 'n',
    description: 'd',
    path: '/p',
    scope: 's',
    interface: { shortDescription: ' short ', displayName: ' D ' },
    dependencies: { tools: [{ type: 't', value: 'v' }, { type: '', value: 'v' }] },
  });
  assert.equal(skill?.enabled, true);
  assert.equal(skill?.shortDescription, 'short');
  assert.equal(skill?.displayName, 'D');
  assert.equal(skill?.dependencies.length, 1);
  assert.equal(mapSkillMetadata({ name: 'n', description: 'd', path: '/p', scope: 's', enabled: false })?.enabled, false);
  assert.equal(mapSkillErrorInfo({ path: '/p', message: '' }), null);
  assert.deepEqual(mapSkillErrorInfo({ path: ' /p ', message: ' m ' }), { path: '/p', message: 'm' });
});

test('plugin catalog mapping preserves defaults, context, and filtering', () => {
  assert.equal(mapPluginSummary({ id: '', name: 'n' }, {}), null);
  const plugin = mapPluginSummary({ id: 'p', name: 'n', source: { type: 'local', path: '/x' } }, {});
  assert.equal(plugin?.installPolicy, 'AVAILABLE');
  assert.equal(plugin?.authPolicy, 'ON_USE');
  assert.equal(plugin?.marketplaceName, 'unknown');
  assert.equal(plugin?.sourceType, 'local');
  assert.equal(plugin?.sourcePath, '/x');
  const marketplace = mapPluginMarketplace({
    name: ' m ',
    path: '/mp',
    interface: { displayName: ' D ' },
    plugins: [{ id: 'p', name: 'n' }, { id: '', name: 'x' }],
  });
  assert.equal(marketplace?.name, 'm');
  assert.equal(marketplace?.plugins.length, 1);
  assert.equal(marketplace?.plugins[0]?.marketplaceName, 'm');
  assert.equal(marketplace?.plugins[0]?.marketplaceDisplayName, 'D');
  assert.equal(mapPluginMarketplace({ name: '' }), null);
  assert.deepEqual(mapPluginLoadError({ marketplacePath: ' /m ', message: ' bad ' }), {
    marketplacePath: '/m',
    message: 'bad',
  });
  assert.equal(mapPluginLoadError({ marketplacePath: '/m' }), null);
});

test('plugin detail, app, and skill summaries preserve fallback context', () => {
  assert.equal(mapPluginDetail(null), null);
  assert.equal(mapPluginDetail({ summary: { id: '', name: '' } }), null);
  const detail = mapPluginDetail({
    summary: { id: 'p', name: 'n' },
    marketplaceName: 'M',
    apps: [{ id: 'a', name: 'an' }, { id: '', name: 'skip' }],
    mcpServers: [' s ', ''],
    skills: [{ name: 'sk', path: '/p', description: 'd' }],
  }, { marketplacePath: '/fp' });
  assert.equal(detail?.summary.marketplaceName, 'M');
  assert.equal(detail?.marketplacePath, '/fp');
  assert.deepEqual(detail?.mcpServers, ['s']);
  assert.equal(detail?.apps.length, 1);
  assert.equal(detail?.skills.length, 1);
  assert.equal(mapPluginAppSummary({ id: 'a' }), null);
  assert.deepEqual(mapPluginAppSummary({ id: 'a', name: 'n' }), {
    id: 'a',
    name: 'n',
    needsAuth: false,
    description: null,
    installUrl: null,
  });
  assert.equal(mapPluginSkillSummary({ name: 'n', path: '/p', description: '' }), null);
  const pluginSkill = mapPluginSkillSummary({ name: 'n', path: '/p', description: 'd', interface: { displayName: ' D ' } });
  assert.equal(pluginSkill?.displayName, 'D');
  assert.equal(pluginSkill?.enabled, true);
});

test('app info and MCP server status mapping preserve defaults', () => {
  assert.equal(mapAppInfo({ id: 'a', name: '' }), null);
  const app = mapAppInfo({
    id: 'a',
    name: 'n',
    isAccessible: 1,
    appMetadata: { categories: [' c ', ''], developer: null },
    branding: { developer: ' dev ' },
    pluginDisplayNames: [' P ', ''],
  } as any);
  assert.equal(app?.isEnabled, true);
  assert.equal(app?.isAccessible, true);
  assert.deepEqual(app?.categories, ['c']);
  assert.equal(app?.developer, 'dev');
  assert.deepEqual(app?.pluginDisplayNames, ['P']);
  assert.equal(mapMcpServerStatus({ name: ' ' }), null);
  assert.deepEqual(mapMcpServerStatus({
    name: 'srv',
    authStatus: null,
    tools: { a: 1, b: 2 },
    resources: [1],
    resourceTemplates: null,
  }), {
    name: 'srv',
    isEnabled: true,
    authStatus: 'unsupported',
    toolCount: 2,
    resourceCount: 1,
    resourceTemplateCount: 0,
  });
});

test('shared debug and structured-text helpers preserve behavior', () => {
  assert.equal(truncateDebugText('  a\n\n b  '), 'a b');
  assert.equal(truncateDebugText('x'.repeat(300)), `${'x'.repeat(240)}...`);
  assert.equal(truncateDebugText(null), '');
  assert.equal(truncateDebugText('abcdef', 3), 'abc...');
  assert.equal(isAgentDeltaNotificationMethod('item/agentMessage/delta'), true);
  assert.equal(isAgentDeltaNotificationMethod('item.assistant_message.delta'), true);
  assert.equal(isAgentDeltaNotificationMethod('item/message/delta'), true);
  assert.equal(isAgentDeltaNotificationMethod('turn/started'), false);
  assert.equal(extractTextCandidate('plain'), 'plain');
  assert.equal(extractTextCandidate({ delta: 'd' }), 'd');
  assert.equal(extractTextCandidate({ parts: [{ text: 'a' }, 'b'] }), 'ab');
  assert.equal(extractTextCandidate({ segments: [] }), null);
  assert.equal(extractTextCandidate(5), null);
  assert.equal(extractStructuredText({ text: 't' }), 't');
  assert.equal(extractStructuredText({ content: [{ text: 'x' }] }), 'x');
  assert.equal(extractStructuredString(' s '), ' s ');
  assert.equal(extractStructuredString(''), null);
  assert.equal(extractStructuredString({ message: 'm' }), 'm');
  assert.equal(extractStructuredString({ error: { text: 'e' } }), 'e');
});
