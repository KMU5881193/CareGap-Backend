import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PythonOcrProvider } from '../../src/modules/be3-intelligence/python-ocr-provider.js';
import { InMemoryOcrRepository, OcrService } from '../../src/modules/be3-intelligence/ocr.js';
import { z } from 'zod';

// No HTTP listener. A synthetic actor authorizes exactly one synthetic person locally.
const pythonPath = process.env.OCR_PYTHON;
if (!pythonPath) throw new Error('OCR_PYTHON must name the isolated Python executable');
const engine = z.enum(['tesseract', 'paddle', 'handwriting-line']).parse(process.argv[2] ?? 'tesseract');
const path = resolve(process.argv[3] ?? 'experiments/handwriting-ocr/samples/synthetic-1-print.png');
const correctedText = process.argv[4] ?? '최근 일주일 동안 식사를 하루 두 번 했다고 함.';
const actor = { user_id: randomUUID(), role: 'staff' as const };
const personId = randomUUID();
const provider = new PythonOcrProvider({ pythonPath, engine });
// Outer service timeout must exceed the process timeout, so the child is killed first.
const service = new OcrService(new InMemoryOcrRepository(), provider,
  { canAccess: async (who, person) => who.user_id === actor.user_id && person === personId }, undefined, 65_000);
const created = await service.create(actor, { person_id: personId, request_key: randomUUID() },
  { filename: path.split(/[\\/]/).at(-1), mimeType: /\.png$/i.test(path) ? 'image/png' : 'image/jpeg', bytes: await readFile(path) });
let job = await service.get(actor, created.id);
while (job.status === 'pending' || job.status === 'processing') {
  await new Promise(resolve => setTimeout(resolve, 100)); job = await service.get(actor, job.id);
}
if (job.status !== 'succeeded') throw new Error(`Local OCR failed: ${job.failure?.code}`);
console.log(JSON.stringify({ phase: 'actual_ocr', engine, original: job.original }));
await service.correct(actor, job.id, { expected_version: 0, text: correctedText });
await service.confirm(actor, job.id, { expected_version: 1 });
console.log(JSON.stringify({ phase: 'confirmed', ...await service.confirmedInput(actor, job.id) }));
