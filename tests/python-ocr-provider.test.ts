import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { PythonOcrProvider } from '../src/modules/be3-intelligence/python-ocr-provider.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
function child() {
  return Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(() => true) });
}
const options = { pythonPath: resolve('isolated-python'), workerPath: resolve('trusted-worker.py'), engine: 'tesseract' as const };
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.useRealTimers());
describe('local Python OCR subprocess boundary', () => {
  it('uses argument arrays and no shell and preserves original Unicode whitespace', async () => {
    const process = child(); vi.mocked(spawn).mockReturnValue(process as never);
    const promise = new PythonOcrProvider(options).extract(new Uint8Array([1]), 'image/png');
    expect(spawn).toHaveBeenCalledWith(options.pythonPath,
      ['-X', 'utf8', '-u', options.workerPath, '--engine', 'tesseract'], expect.objectContaining({ shell: false, windowsHide: true }));
    const payload = process.stdin.read().toString();
    expect(JSON.parse(payload)).toEqual({ mime_type: 'image/png', base64: 'AQ==' });
    const output = Buffer.from(JSON.stringify({ ok: true, engine: 'tesseract', text: '  합성\n' }));
    for (const byte of output) process.stdout.write(Buffer.from([byte]));
    process.stderr.write('private diagnostics'); process.emit('close', 0);
    await expect(promise).resolves.toBe('  합성\n');
  });
  it('kills timed out work and holds the concurrency slot until close', async () => {
    vi.useFakeTimers(); const process = child(); vi.mocked(spawn).mockReturnValue(process as never);
    const provider = new PythonOcrProvider({ ...options, timeoutMs: 10 });
    const promise = provider.extract(new Uint8Array([1]), 'image/png');
    const rejection = expect(promise).rejects.toMatchObject({ code: 'OCR_PROCESS_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(11); expect(process.kill).toHaveBeenCalledWith('SIGKILL');
    await expect(provider.extract(new Uint8Array([1]), 'image/png')).rejects.toMatchObject({ code: 'OCR_BUSY' });
    process.emit('close', null); await rejection;
    const next = child(); vi.mocked(spawn).mockReturnValue(next as never);
    const second = provider.extract(new Uint8Array([1]), 'image/png');
    next.stdout.write(JSON.stringify({ ok: true, engine: 'tesseract', text: '합성' })); next.emit('close', 0);
    await expect(second).resolves.toBe('합성');
  });
  it.each(['stdout', 'stderr'] as const)('bounds %s and never exposes diagnostics', async stream => {
    const process = child(); vi.mocked(spawn).mockReturnValue(process as never);
    const promise = new PythonOcrProvider(options).extract(new Uint8Array([1]), 'image/png');
    process[stream].write(Buffer.alloc(513 * 1024)); expect(process.kill).toHaveBeenCalled();
    process.emit('close', 1); await expect(promise).rejects.toMatchObject({ code: 'OCR_OUTPUT_LIMIT' });
  });
  it.each(['not-json', '{"ok":false,"error":"private"}', '{"ok":true,"engine":"paddle","text":"wrong engine"}'])('rejects invalid protocol %s', async output => {
    const process = child(); vi.mocked(spawn).mockReturnValue(process as never);
    const promise = new PythonOcrProvider(options).extract(new Uint8Array([1]), 'image/png');
    process.stdout.write(output); process.emit('close', 0);
    await expect(promise).rejects.toMatchObject({ code: 'OCR_PROTOCOL_FAILED' });
  });
  it('handles startup and exit failures', async () => {
    for (const start of [true, false]) {
      const process = child(); vi.mocked(spawn).mockReturnValue(process as never);
      const promise = new PythonOcrProvider(options).extract(new Uint8Array([1]), 'image/png');
      if (start) process.emit('error', new Error('private path')); else process.emit('close', 1);
      await expect(promise).rejects.toMatchObject({ code: start ? 'OCR_PROCESS_START_FAILED' : 'OCR_PROCESS_FAILED' });
    }
  });
  it('holds the slot after an error on an already running process', async () => {
    const process = Object.assign(child(), { pid: 1234 }); vi.mocked(spawn).mockReturnValue(process as never);
    const provider = new PythonOcrProvider(options);
    const promise = provider.extract(new Uint8Array([1]), 'image/png');
    process.emit('error', new Error('private process detail'));
    await expect(provider.extract(new Uint8Array([1]), 'image/png')).rejects.toMatchObject({ code: 'OCR_BUSY' });
    process.emit('close', 1);
    await expect(promise).rejects.toMatchObject({ code: 'OCR_PROCESS_FAILED' });
  });
  it('kills the process when its input pipe fails', async () => {
    const process = child(); vi.mocked(spawn).mockReturnValue(process as never);
    const promise = new PythonOcrProvider(options).extract(new Uint8Array([1]), 'image/png');
    process.stdin.emit('error', new Error('private EPIPE'));
    expect(process.kill).toHaveBeenCalledWith('SIGKILL'); process.emit('close', 1);
    await expect(promise).rejects.toMatchObject({ code: 'OCR_PROCESS_INPUT_FAILED' });
  });
  it('rejects relative commands, invalid limits and unsupported engines', () => {
    for (const invalid of [{ pythonPath: 'python' }, { timeoutMs: 0 }, { maxConcurrency: 0 }, { engine: 'shell' }]) {
      expect(() => new PythonOcrProvider({ ...options, ...invalid } as never)).toThrow();
    }
  });
  it('rejects bad inputs before starting any process', async () => {
    const provider = new PythonOcrProvider(options);
    for (const [bytes, mime] of [[new Uint8Array(), 'image/png'], [new Uint8Array([1]), 'text/plain'], [new Uint8Array(5 * 1024 * 1024 + 1), 'image/png']] as const) {
      await expect(provider.extract(bytes, mime)).rejects.toMatchObject({ code: 'INVALID_OCR_INPUT' });
    }
    expect(spawn).not.toHaveBeenCalled();
  });
});
