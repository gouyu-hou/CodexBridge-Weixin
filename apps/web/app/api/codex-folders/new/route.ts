import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { clearWebQueryCaches } from '@/lib/server/queries';
import { runTsxJsonWorker } from '@/server/tsx-json-worker';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const payload = await request.json().catch(() => null) as {
    cwd?: unknown;
    model?: unknown;
    permissionsMode?: unknown;
    reasoningEffort?: unknown;
  } | null;
  const cwd = typeof payload?.cwd === 'string' ? payload.cwd.trim() : '';
  const model = typeof payload?.model === 'string' ? payload.model.trim() : '';
  const permissionsMode = typeof payload?.permissionsMode === 'string' ? payload.permissionsMode.trim() : '';
  const reasoningEffort = typeof payload?.reasoningEffort === 'string' ? payload.reasoningEffort.trim() : '';

  const scriptPath = path.join(process.cwd(), 'server', 'create-codex-thread.ts');
  const repoRoot = path.resolve(process.cwd(), '..', '..');
  const stateDir = process.env.CODEXBRIDGE_STATE_DIR ?? path.join(process.env.HOME ?? '', '.codexbridge');

  const parsed = await runTsxJsonWorker<{
    ok?: boolean;
    threadId?: string;
    bridgeSessionId?: string;
    cwd?: string | null;
    title?: string | null;
  }>({
    cwd: process.cwd(),
    input: {
      cwd: cwd || null,
      model: model || null,
      permissionsMode: permissionsMode || null,
      reasoningEffort: reasoningEffort || null,
      stateDir,
      repoRoot,
    },
    scriptPath,
  });

  clearWebQueryCaches();

  return NextResponse.json(parsed);
}
