import { spawn } from 'node:child_process';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_ERROR_MESSAGE_LENGTH = 4_096;

type RunTsxJsonWorkerOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input: unknown;
  maxOutputBytes?: number;
  scriptPath: string;
  timeoutMs?: number;
};

export function runTsxJsonWorker<T>({
  cwd = process.cwd(),
  env = process.env,
  input,
  maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
  scriptPath,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: RunTsxJsonWorkerOptions): Promise<T> {
  const resolvedTimeoutMs = requirePositiveInteger(timeoutMs, 'timeoutMs');
  const resolvedMaxOutputBytes = requirePositiveInteger(maxOutputBytes, 'maxOutputBytes');

  return new Promise<T>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', scriptPath], {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let settled = false;
    let terminatingError: Error | null = null;
    let stderr = '';
    let stdout = '';
    let outputBytes = 0;

    const timer = setTimeout(() => {
      terminate(new Error(`worker_timeout:${resolvedTimeoutMs}`));
    }, resolvedTimeoutMs);

    function finish(error: Error | null, result?: T) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (error) {
        reject(error);
        return;
      }
      resolve(result as T);
    }

    function terminate(error: Error) {
      if (settled || terminatingError) {
        return;
      }
      terminatingError = error;
      clearTimeout(timer);
      if (!child.kill()) {
        finish(error);
      }
    }

    function appendOutput(target: 'stderr' | 'stdout', chunk: unknown) {
      if (settled || terminatingError) {
        return;
      }
      const text = String(chunk);
      outputBytes += Buffer.byteLength(text, 'utf8');
      if (outputBytes > resolvedMaxOutputBytes) {
        terminate(new Error(`worker_output_limit_exceeded:${resolvedMaxOutputBytes}`));
        return;
      }
      if (target === 'stdout') {
        stdout += text;
      } else {
        stderr += text;
      }
    }

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => appendOutput('stdout', chunk));
    child.stderr.on('data', (chunk) => appendOutput('stderr', chunk));
    child.once('error', (error) => finish(error));
    child.once('close', (code, signal) => {
      if (settled) {
        return;
      }
      if (terminatingError) {
        finish(terminatingError);
        return;
      }
      if (code !== 0) {
        const detail = stderr.trim().slice(0, MAX_ERROR_MESSAGE_LENGTH);
        finish(new Error(detail || `worker_failed:${code ?? signal ?? 'unknown'}`));
        return;
      }
      try {
        finish(null, JSON.parse(stdout) as T);
      } catch {
        finish(new Error('worker_invalid_json'));
      }
    });
    child.stdin.once('error', (error) => terminate(error));
    child.stdin.end(JSON.stringify(input));
  });
}

function requirePositiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label}_must_be_a_positive_integer`);
  }
  return value;
}
