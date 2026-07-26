import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { getWebPaths } from '@/lib/server/runtime';
import { runTsxJsonWorker } from '@/server/tsx-json-worker';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const model = searchParams.get('model')?.trim() || '';
  const reasoningEffort = searchParams.get('reasoningEffort')?.trim() || '';
  const scriptPath = path.join(process.cwd(), 'server', 'read-codex-launch-model-options.ts');
  const { stateDir } = getWebPaths();

  try {
    const parsed = await runTsxJsonWorker<Record<string, unknown>>({
      cwd: process.cwd(),
      input: {
        model: model || null,
        reasoningEffort: reasoningEffort || null,
        stateDir,
      },
      scriptPath,
    });
    return NextResponse.json(parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'launch_model_options_failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
