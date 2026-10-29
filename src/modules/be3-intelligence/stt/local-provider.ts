import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TranscriptOutput, SttError, type TranscriptProvider } from './model.js';

export interface LocalSttOptions { pythonPath: string; modelPath: string; workerPath?: string; timeoutMs?: number }
// Trusted development configuration only. No request may supply executable paths.
export class LocalWhisperProvider implements TranscriptProvider {
  private options: Required<LocalSttOptions>;
  private active = false;
  constructor(options: LocalSttOptions) {
    this.options = { ...options, timeoutMs: options.timeoutMs ?? 90_000,
      workerPath: options.workerPath ?? fileURLToPath(new URL('../../../../experiments/stt/worker.py', import.meta.url)) };
    if (![this.options.pythonPath, this.options.modelPath, this.options.workerPath].every(isAbsolute)
      || !Number.isSafeInteger(this.options.timeoutMs) || this.options.timeoutMs < 1 || this.options.timeoutMs > 240_000) throw new SttError('INVALID_STT_CONFIGURATION');
  }
  async transcribe(input: Uint8Array, mimeType: string, signal?: AbortSignal) { return (await this.transcribeSegments(input, mimeType, signal)).text; }
  async transcribeSegments(input: Uint8Array, mimeType: string, signal?: AbortSignal): Promise<TranscriptOutput> {
    if (!(input instanceof Uint8Array) || !input.length || input.length > 10 * 1024 * 1024 || mimeType !== 'audio/wav') throw new SttError('INVALID_STT_INPUT');
    if (signal?.aborted) throw new SttError('STT_ABORTED');
    if (this.active) throw new SttError('STT_BUSY');
    this.active = true;
    return new Promise((resolve, reject) => {
      let ended = false, fault: string | undefined, timer: ReturnType<typeof setTimeout> | undefined;
      const output: Buffer[] = []; let stdoutBytes = 0, stderrBytes = 0;
      let cancel = () => {};
      const finish = (code?: string, value?: TranscriptOutput) => {
        if (ended) return;
        ended = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel); this.active = false;
        if (code) reject(new SttError(code)); else resolve(value!);
      };
      try {
        const child = spawn(this.options.pythonPath, ['-X', 'utf8', '-u', this.options.workerPath, '--model-dir', this.options.modelPath],
          { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PYTHONUTF8: '1', HF_HUB_OFFLINE: '1' } });
        const stop = (code: string) => { fault ??= code; child.kill('SIGKILL'); };
        cancel = () => stop('STT_ABORTED');
        signal?.addEventListener('abort', cancel, { once: true });
        if (signal?.aborted) cancel();
        timer = setTimeout(() => stop('STT_PROCESS_TIMEOUT'), this.options.timeoutMs);
        child.stdout.on('data', (chunk: Buffer) => {
          stdoutBytes += chunk.length;
          if (stdoutBytes > 1024 * 1024) stop('STT_OUTPUT_LIMIT'); else output.push(Buffer.from(chunk));
        });
        child.stderr.on('data', (chunk: Buffer) => { stderrBytes += chunk.length; if (stderrBytes > 64 * 1024) stop('STT_OUTPUT_LIMIT'); });
        child.stdin.on('error', () => stop('STT_INPUT_FAILED'));
        child.on('error', () => { if (!child.pid) finish('STT_PROCESS_START_FAILED'); else fault ??= 'STT_PROCESS_FAILED'; });
        child.on('close', code => {
          if (fault) return finish(fault);
          if (code !== 0) return finish('STT_PROCESS_FAILED');
          try {
            const parsed = TranscriptOutput.safeParse(JSON.parse(Buffer.concat(output).toString('utf8')));
            if (!parsed.success) return finish('STT_PROTOCOL_FAILED');
            finish(undefined, parsed.data);
          } catch { finish('STT_PROTOCOL_FAILED'); }
        });
        child.stdin.end(Buffer.from(input));
      } catch { finish('STT_PROCESS_START_FAILED'); }
    });
  }
}
