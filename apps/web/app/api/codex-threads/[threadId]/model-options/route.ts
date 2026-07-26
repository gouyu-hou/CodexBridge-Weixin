import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { getWebPaths } from '@/lib/server/runtime';
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

  const scriptPath = path.join(process.cwd(), 'server', 'update-codex-thread-settings.ts');
  const { stateDir } = getWebPaths();

  try {
    const parsed = await runTsxJsonWorker<Record<string, unknown>>({
      cwd: process.cwd(),
      input: {
        threadId,
        stateDir,
      },
      scriptPath,
    });
    return NextResponse.json(parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'model_options_failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
