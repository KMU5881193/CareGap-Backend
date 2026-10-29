import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalWhisperProvider } from '../src/modules/be3-intelligence/stt/local-provider.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
const config = { pythonPath: resolve('python'), modelPath: resolve('model'), workerPath: resolve('worker.py') };
const output = { text: '  합성\n', segments: [{ start_ms: 0, end_ms: 1000, speaker_id: 'unknown', text: '  합성\n' }], timing: 'asr_timestamps', diarization: 'none' };
const child = () => Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), kill: vi.fn(() => true) });
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.useRealTimers());
describe('local STT process boundary', () => {
  it('uses safe arguments, binary stdin, separated diagnostics and exact Unicode output', async () => {
    const process = child(); vi.mocked(spawn).mockReturnValue(process as never);
    const promise = new LocalWhisperProvider(config).transcribeSegments(new Uint8Array([1, 2]), 'audio/wav');
    expect(spawn).toHaveBeenCalledWith(config.pythonPath, ['-X', 'utf8', '-u', config.workerPath, '--model-dir', config.modelPath],
      expect.objectContaining({ shell: false, windowsHide: true }));
    expect(process.stdin.read()).toEqual(Buffer.from([1, 2]));
    process.stderr.write('private diagnostics');
    for (const byte of Buffer.from(JSON.stringify(output))) process.stdout.write(Buffer.from([byte]));
    process.emit('close', 0); await expect(promise).resolves.toEqual(output);
  });
  it('implements the original string-returning SttProvider interface', async () => {
    const process = child(); vi.mocked(spawn).mockReturnValue(process as never);
    const promise = new LocalWhisperProvider(config).transcribe(new Uint8Array([1]), 'audio/wav');
    process.stdout.write(JSON.stringify(output)); process.emit('close', 0);
    await expect(promise).resolves.toBe('  합성\n');
  });
  it('kills timed-out work and holds its slot until close', async () => {
    vi.useFakeTimers(); const process = child(); vi.mocked(spawn).mockReturnValue(process as never);
    const provider = new LocalWhisperProvider({ ...config, timeoutMs: 10 });
    const promise = provider.transcribe(new Uint8Array([1]), 'audio/wav');
    const rejection = expect(promise).rejects.toMatchObject({ code: 'STT_PROCESS_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(11); expect(process.kill).toHaveBeenCalledWith('SIGKILL');
    await expect(provider.transcribe(new Uint8Array([1]), 'audio/wav')).rejects.toMatchObject({ code: 'STT_BUSY' });
    process.emit('close', null); await rejection;
  });
  it('cancels a running process and releases its slot only after close', async () => {
    const process = child(); vi.mocked(spawn).mockReturnValue(process as never);
    const controller = new AbortController(), provider = new LocalWhisperProvider(config);
    const promise = provider.transcribe(new Uint8Array([1]), 'audio/wav', controller.signal);
    controller.abort(); expect(process.kill).toHaveBeenCalledWith('SIGKILL');
    await expect(provider.transcribe(new Uint8Array([1]), 'audio/wav')).rejects.toMatchObject({ code: 'STT_BUSY' });
    process.emit('close', null); await expect(promise).rejects.toMatchObject({ code: 'STT_ABORTED' });
    const next = child(); vi.mocked(spawn).mockReturnValue(next as never);
    const again = provider.transcribe(new Uint8Array([1]), 'audio/wav'); next.stdout.write(JSON.stringify(output)); next.emit('close', 0);
    await expect(again).resolves.toBe(output.text);
  });
  it.each(['stdout', 'stderr'] as const)('bounds %s without exposing private output', async stream => {
    const process = child(); vi.mocked(spawn).mockReturnValue(process as never);
    const promise = new LocalWhisperProvider(config).transcribe(new Uint8Array([1]), 'audio/wav');
    process[stream].write(Buffer.alloc(1024 * 1024 + 1)); expect(process.kill).toHaveBeenCalled(); process.emit('close', 1);
    await expect(promise).rejects.toMatchObject({ code: 'STT_OUTPUT_LIMIT' });
  });
  it.each(['not-json', '{}', '{"text":"private"}'])('rejects malformed protocol %s', async raw => {
    const process = child(); vi.mocked(spawn).mockReturnValue(process as never);
    const promise = new LocalWhisperProvider(config).transcribe(new Uint8Array([1]), 'audio/wav');
    process.stdout.write(raw); process.emit('close', 0);
    await expect(promise).rejects.toMatchObject({ code: 'STT_PROTOCOL_FAILED' });
  });
  it('safely handles process start, pipe and exit errors', async () => {
    for (const failure of ['start', 'input', 'exit']) {
      const process = child(); vi.mocked(spawn).mockReturnValue(process as never);
      const promise = new LocalWhisperProvider(config).transcribe(new Uint8Array([1]), 'audio/wav');
      if (failure === 'start') process.emit('error', new Error('private path'));
      if (failure === 'input') process.stdin.emit('error', new Error('private pipe'));
      process.emit('close', 1);
      await expect(promise).rejects.toMatchObject({ code: failure === 'start' ? 'STT_PROCESS_START_FAILED' : failure === 'input' ? 'STT_INPUT_FAILED' : 'STT_PROCESS_FAILED' });
    }
  });
  it('rejects relative paths, invalid limits, bad audio and pre-aborted requests', async () => {
    expect(() => new LocalWhisperProvider({ ...config, pythonPath: 'python' })).toThrow();
    expect(() => new LocalWhisperProvider({ ...config, timeoutMs: 0 })).toThrow();
    const provider = new LocalWhisperProvider(config);
    await expect(provider.transcribe(new Uint8Array(), 'audio/wav')).rejects.toMatchObject({ code: 'INVALID_STT_INPUT' });
    await expect(provider.transcribe(new Uint8Array([1]), 'audio/mp3')).rejects.toMatchObject({ code: 'INVALID_STT_INPUT' });
    const controller = new AbortController(); controller.abort();
    await expect(provider.transcribe(new Uint8Array([1]), 'audio/wav', controller.signal)).rejects.toMatchObject({ code: 'STT_ABORTED' });
    expect(spawn).not.toHaveBeenCalled();
  });
});
