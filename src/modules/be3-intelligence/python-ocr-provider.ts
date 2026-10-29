import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { OcrProvider } from './analysis.js';

const Engine = z.enum(['tesseract', 'paddle', 'handwriting-line']);
const Output = z.object({ ok: z.literal(true), engine: Engine, text: z.string().max(100_000) });
export class OcrProcessError extends Error {
  constructor(public readonly code: string) { super(code); }
}
export interface PythonOcrOptions {
  pythonPath: string;
  engine: z.infer<typeof Engine>;
  workerPath?: string;
  timeoutMs?: number;
  maxConcurrency?: number;
}

// Development-only trusted configuration. Never construct from HTTP request fields.
// One bounded subprocess per extraction, no shell, no image files or public server.
export class PythonOcrProvider implements OcrProvider {
  private readonly options: Required<PythonOcrOptions>;
  private active = 0;
  constructor(options: PythonOcrOptions) {
    this.options = { ...options,
      engine: Engine.parse(options.engine),
      workerPath: options.workerPath ?? fileURLToPath(new URL('../../../experiments/handwriting-ocr/worker.py', import.meta.url)),
      timeoutMs: options.timeoutMs ?? 60_000, maxConcurrency: options.maxConcurrency ?? 1 };
    if (!isAbsolute(this.options.pythonPath) || !isAbsolute(this.options.workerPath)
      || !Number.isSafeInteger(this.options.timeoutMs) || this.options.timeoutMs < 1 || this.options.timeoutMs > 180_000
      || !Number.isSafeInteger(this.options.maxConcurrency) || this.options.maxConcurrency < 1 || this.options.maxConcurrency > 4) {
      throw new OcrProcessError('INVALID_OCR_CONFIGURATION');
    }
  }
  async extract(input: Uint8Array, mimeType: string): Promise<string> {
    if (!(input instanceof Uint8Array) || !input.length || input.length > 5 * 1024 * 1024
      || !['image/jpeg', 'image/png'].includes(mimeType)) throw new OcrProcessError('INVALID_OCR_INPUT');
    if (this.active >= this.options.maxConcurrency) throw new OcrProcessError('OCR_BUSY');
    this.active++;
    return new Promise<string>((resolve, reject) => {
      let finished = false;
      let fault: string | undefined;
      let outputBytes = 0, errorBytes = 0;
      const output: Buffer[] = [];
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (code?: string, text?: string) => {
        if (finished) return;
        finished = true; clearTimeout(timer); this.active--;
        if (code) reject(new OcrProcessError(code)); else resolve(text!);
      };
      try {
        const child = spawn(this.options.pythonPath,
          ['-X', 'utf8', '-u', this.options.workerPath, '--engine', this.options.engine],
          { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, PYTHONUTF8: '1' } });
        const abort = (code: string) => {
          fault ??= code;
          child.kill('SIGKILL');
          // Hold the slot until close confirms the process and pipes are gone.
        };
        timer = setTimeout(() => abort('OCR_PROCESS_TIMEOUT'), this.options.timeoutMs);
        child.stdout.on('data', (chunk: Buffer) => {
          outputBytes += chunk.length;
          if (outputBytes > 512 * 1024) abort('OCR_OUTPUT_LIMIT');
          else output.push(Buffer.from(chunk));
        });
        child.stderr.on('data', (chunk: Buffer) => {
          errorBytes += chunk.length;
          if (errorBytes > 64 * 1024) abort('OCR_OUTPUT_LIMIT');
          // Drain diagnostics without logging or exposing provider internals.
        });
        child.on('error', () => {
          if (!child.pid) finish('OCR_PROCESS_START_FAILED');
          else fault ??= 'OCR_PROCESS_FAILED';
        });
        child.stdin.on('error', () => abort('OCR_PROCESS_INPUT_FAILED'));
        child.on('close', code => {
          if (fault) return finish(fault);
          if (code !== 0) return finish('OCR_PROCESS_FAILED');
          try {
            const parsed = Output.safeParse(JSON.parse(Buffer.concat(output).toString('utf8')));
            if (!parsed.success || parsed.data.engine !== this.options.engine) return finish('OCR_PROTOCOL_FAILED');
            finish(undefined, parsed.data.text);
          } catch { finish('OCR_PROTOCOL_FAILED'); }
        });
        child.stdin.end(JSON.stringify({ mime_type: mimeType, base64: Buffer.from(input).toString('base64') }) + '\n');
      } catch { finish('OCR_PROCESS_START_FAILED'); }
    });
  }
}
