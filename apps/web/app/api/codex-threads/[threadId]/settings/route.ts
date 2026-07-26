import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { getWebCodexThreadSettings, clearWebQueryCaches } from '@/lib/server/queries';
import { clearRuntimeJsonCache, getWebPaths } from '@/lib/server/runtime';
import { runTsxJsonWorker } from '@/server/tsx-json-worker';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ threadId: string }> },
) {
  const { threadId } = await context.params;
  if (!threadId) {
    return NextResponse.json({ error: 'threadId is required' }, { status: 400 });
  }
  const settings = await getWebCodexThreadSettings(threadId);
  if (!settings) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return NextResponse.json(settings);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ threadId: string }> },
) {
  const { threadId } = await context.params;
  const payload = await request.json().catch(() => null) as {
    permissionsMode?: unknown;
    model?: unknown;
    reasoningEffort?: unknown;
  } | null;
  const permissionsMode = typeof payload?.permissionsMode === 'string' ? payload.permissionsMode.trim() : '';
  const hasModel = Boolean(payload) && Object.prototype.hasOwnProperty.call(payload, 'model');
  const hasReasoningEffort = Boolean(payload) && Object.prototype.hasOwnProperty.call(payload, 'reasoningEffort');
  const model = hasModel ? payload?.model ?? null : undefined;
  const reasoningEffort = hasReasoningEffort ? payload?.reasoningEffort ?? null : undefined;
  if (!threadId || (!permissionsMode && !hasModel && !hasReasoningEffort)) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const scriptPath = path.join(process.cwd(), 'server', 'update-codex-thread-settings.ts');
  const { stateDir } = getWebPaths();

  const parsed = await runTsxJsonWorker<Record<string, unknown>>({
    cwd: process.cwd(),
    input: {
      threadId,
      ...(permissionsMode ? { permissionsMode } : {}),
      ...(hasModel ? { model } : {}),
      ...(hasReasoningEffort ? { reasoningEffort } : {}),
      stateDir,
    },
    scriptPath,
  });

  clearRuntimeJsonCache('session_settings.json');
  clearRuntimeJsonCache('bridge_sessions.json');
  clearRuntimeJsonCache('platform_bindings.json');
  clearWebQueryCaches();

  return NextResponse.json(parsed);
}
