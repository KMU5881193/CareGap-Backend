import express from 'express';
import sharp from 'sharp';
import { z, ZodError } from 'zod';
import { pathToFileURL } from 'node:url';
import { OcrService, InMemoryOcrRepository, MockOcrProvider } from '../src/modules/be3-intelligence/ocr.js';
import { TranscriptService, InMemoryTranscriptRepository, MockSttProvider } from '../src/modules/be3-intelligence/stt/service.js';
import { AnalysisWorkflow } from '../src/modules/be3-intelligence/analysis-workflow.js';
import { SyntheticAnalysisProvider, syntheticCurrent } from '../src/modules/be3-intelligence/analysis-mock.js';
import { syntheticAnalysisFixture } from '../src/modules/be3-intelligence/analysis-synthetic-fixture.js';
import { AnalysisWelfareBridge } from '../src/modules/be3-intelligence/analysis-welfare-bridge.js';
import { WelfareRecommendationService } from '../src/modules/be3-intelligence/welfare-service.js';
import { syntheticWelfareCatalog } from '../src/modules/be3-intelligence/welfare-catalog.js';
import { WelfareNeed } from '../src/modules/be3-intelligence/welfare-contracts.js';

export const previewMetadata = {
  demo_mode: true, data_origin: 'synthetic', providers: { ocr: 'mock', stt: 'mock', analysis: 'mock' },
  authentication: 'fixed_synthetic_actor_only', authorization: 'synthetic_fixture_check_only',
  records: 'code_owned_fixture_not_official_be2_storage', catalog: 'synthetic_demo',
};
class PreviewError extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}
const empty = z.object({}).strict();
const version = z.object({ expected_version: z.number().int().nonnegative() }).strict();
const needsSchema = z.object({ needs: z.array(WelfareNeed).min(1).max(3)
  .refine(items => new Set(items).size === items.length), confirmed: z.literal(true) }).strict();
function wav() {
  const b = Buffer.alloc(16044);
  b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(16000, 40); return b;
}

export function createPreviewApp(optIn: unknown) {
  if (optIn !== '1') throw new PreviewError('PREVIEW_OPT_IN_REQUIRED', 403);
  const app = express(); app.disable('x-powered-by');
  const fixture = syntheticAnalysisFixture();
  const { actor } = fixture;
  const authorization = { async canAccess(a: typeof actor, person: string) {
    return a.user_id === actor.user_id && a.role === 'staff' && person === fixture.input.person_id;
  } };
  const ocr = new OcrService(new InMemoryOcrRepository(), new MockOcrProvider(), authorization);
  const stt = new TranscriptService(new InMemoryTranscriptRepository(), new MockSttProvider(), authorization);
  const workflow = new AnalysisWorkflow({ authorization, provider: new SyntheticAnalysisProvider(), provider_kind: 'mock',
    records: { async getVersion(c, v) { return fixture.records.find(r => r.consultation_id === c && r.record_version_id === v) ?? null; } },
  });
  const welfare = new WelfareRecommendationService({ authorization, catalog: syntheticWelfareCatalog() });
  const bridge = new AnalysisWelfareBridge(workflow, welfare);
  let ocrId: string | undefined, sttId: string | undefined, analysisId: string | undefined;
  let confirmedNeeds: z.infer<typeof needsSchema> | undefined;
  let queue = Promise.resolve();
  const send = (res: express.Response, data: unknown, status = 200) => res.status(status).json({ ...previewMetadata, data });
  const requireId = (id?: string) => { if (!id) throw new PreviewError('PREVIEW_STAGE_REQUIRED', 409); return id; };
  const wrap = (fn: (req: express.Request, res: express.Response) => Promise<unknown>) =>
    (req: express.Request, res: express.Response, next: express.NextFunction) => {
      // One small, fixed scenario per server; serialize mutations to preserve its order.
      const work = queue.then(() => fn(req, res)); queue = work.then(() => {}, () => {}); work.catch(next);
    };
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!/^\/preview(?:\/|$)/.test(req.path)) { res.status(404).json({ ...previewMetadata, error: { code: 'PREVIEW_ONLY', message: 'PREVIEW_ONLY' } }); return; }
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.get('host') ?? '')) { next(new PreviewError('PREVIEW_HOST_REJECTED', 403)); return; }
    const origin = req.get('origin');
    if (origin) {
      let allowed = false;
      try { const url = new URL(origin); allowed = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname) && url.origin === origin; } catch { /* deny */ }
      if (!allowed) { next(new PreviewError('PREVIEW_ORIGIN_REJECTED', 403)); return; }
      res.set('Access-Control-Allow-Origin', origin); res.vary('Origin');
      res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS'); res.set('Access-Control-Allow-Headers', 'Content-Type');
    }
    if (Object.keys(req.query).length) { next(new PreviewError('PREVIEW_INVALID_REQUEST')); return; }
    if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
    if (req.method === 'POST' && !req.is('application/json')) { next(new PreviewError('PREVIEW_JSON_REQUIRED', 415)); return; }
    if (req.method === 'GET' && (req.get('content-length') || req.get('transfer-encoding'))) { next(new PreviewError('PREVIEW_INVALID_REQUEST')); return; }
    next();
  });
  app.use(express.json({ limit: '2kb' }));
  app.get('/preview/scenario', wrap(async (_req, res) => send(res, {
    scenario_id: 'caregap-fixed-v1', actor, records: fixture.records,
    ocr: ocrId ? await ocr.get(actor, ocrId) : null,
    stt: sttId ? await stt.get(actor, sttId) : null,
    analysis: analysisId ? await workflow.get(actor, analysisId) : null,
    needs: confirmedNeeds ?? null,
    corrections: { ocr_text: syntheticCurrent, stt_segments: [{ start_ms: 0, end_ms: 1000, speaker_id: 'speaker_1', text: syntheticCurrent }] },
    connection: 'confirmed_ocr_or_stt_gate_then_existing_synthetic_record_fixture',
  })));
  app.post('/preview/ocr/jobs', wrap(async (req, res) => {
    empty.parse(req.body);
    if (!ocrId) {
      const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'white' } }).png().toBuffer();
      ocrId = (await ocr.create(actor, { person_id: fixture.input.person_id, request_key: 'preview-ocr' }, { filename: 'synthetic.png', mimeType: 'image/png', bytes })).id;
    }
    return send(res, await ocr.get(actor, ocrId), 202);
  }));
  app.get('/preview/ocr/result', wrap(async (_req, res) => send(res, await ocr.get(actor, requireId(ocrId)))));
  app.post('/preview/ocr/corrections', wrap(async (req, res) => {
    const body = version.parse(req.body); return send(res, await ocr.correct(actor, requireId(ocrId), { ...body, text: syntheticCurrent }));
  }));
  app.post('/preview/ocr/confirmation', wrap(async (req, res) => send(res, await ocr.confirm(actor, requireId(ocrId), version.parse(req.body)))));
  app.post('/preview/stt/jobs', wrap(async (req, res) => {
    empty.parse(req.body);
    sttId ??= (await stt.create(actor, { person_id: fixture.input.person_id, request_key: 'preview-stt' }, { filename: 'synthetic.wav', mimeType: 'audio/wav', bytes: wav() })).id;
    return send(res, await stt.get(actor, sttId), 202);
  }));
  app.get('/preview/stt/result', wrap(async (_req, res) => send(res, await stt.get(actor, requireId(sttId)))));
  app.post('/preview/stt/corrections', wrap(async (req, res) => {
    const body = version.parse(req.body); return send(res, await stt.correct(actor, requireId(sttId), { ...body,
      segments: [{ start_ms: 0, end_ms: 1000, speaker_id: 'speaker_1', text: syntheticCurrent }] }));
  }));
  app.post('/preview/stt/confirmation', wrap(async (req, res) => send(res, await stt.confirm(actor, requireId(sttId), version.parse(req.body)))));
  app.post('/preview/analyses', wrap(async (req, res) => {
    const body = z.object({ source: z.enum(['ocr', 'stt']) }).strict().parse(req.body);
    if (body.source === 'ocr') await ocr.confirmedInput(actor, requireId(ocrId));
    else await stt.confirmedInput(actor, requireId(sttId));
    // Gate is real; BE2 persistence is NOT simulated as an official write.
    const entry = await workflow.create(actor, fixture.input, 'preview-analysis'); analysisId = entry.id;
    return send(res, entry);
  }));
  app.get('/preview/analysis', wrap(async (_req, res) => send(res, await workflow.get(actor, requireId(analysisId)))));
  app.post('/preview/analysis/reviews', wrap(async (req, res) => {
    const body = z.object({ expected_version: z.number().int().positive(), action: z.enum(['edit', 'submit', 'approve', 'reject']) }).strict().parse(req.body);
    let draft;
    if (body.action === 'edit') {
      draft = (await workflow.get(actor, requireId(analysisId))).edited;
      if (draft) draft.questions[0] = '합성 담당자 수정: 식사 지원 필요를 확인할까요?';
    }
    return send(res, await workflow.review(actor, requireId(analysisId), { ...body, ...(draft ? { draft } : {}) }));
  }));
  app.get('/preview/analysis/published', wrap(async (_req, res) => send(res, await workflow.published(actor, requireId(analysisId)))));
  app.post('/preview/needs/confirmation', wrap(async (req, res) => {
    const body = needsSchema.parse(req.body);
    await workflow.published(actor, requireId(analysisId)); confirmedNeeds = body;
    return send(res, { ...body, needs_origin: 'explicit_staff_confirmation', confirmed_by: actor.user_id });
  }));
  app.post('/preview/welfare-recommendations', wrap(async (req, res) => {
    empty.parse(req.body);
    const approved = await workflow.published(actor, requireId(analysisId));
    if (!confirmedNeeds) throw new PreviewError('NEEDS_NOT_CONFIRMED', 409);
    const indexes = { meal_support: 0, mobility_support: 1, medication_management: 2 };
    const result = await bridge.recommend(actor, { analysis_id: approved.id, expected_analysis_version: approved.version,
      confirmations: confirmedNeeds.needs.map(need => ({ need, finding_index: indexes[need], evidence_index: 1, confirmed: true })) });
    return res.json({ ...previewMetadata, ...result });
  }));
  app.use((_req, res) => res.status(404).json({ ...previewMetadata, error: { code: 'NOT_FOUND', message: 'NOT_FOUND' } }));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const known = error as { code?: unknown; status?: unknown; type?: unknown };
    const status = error instanceof ZodError || error instanceof SyntaxError ? 400 : known.type === 'entity.too.large' ? 413 : typeof known.status === 'number' ? known.status : 500;
    const code = error instanceof ZodError || error instanceof SyntaxError ? 'PREVIEW_INVALID_REQUEST' : status === 413 ? 'PREVIEW_BODY_TOO_LARGE' : status !== 500 && typeof known.code === 'string' ? known.code : 'PREVIEW_INTERNAL_ERROR';
    res.status(status).json({ ...previewMetadata, error: { code, message: code } });
  });
  return app;
}

export function startPreviewServer(optIn: unknown) {
  const app = createPreviewApp(optIn);
  return app.listen(4313, '127.0.0.1', () => console.log('Synthetic preview: http://127.0.0.1:4313/preview/scenario'));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Read only the expressly authorized, non-secret opt-in switch; no dotenv/config.
  try { startPreviewServer(process.env.CAREGAP_SYNTHETIC_PREVIEW); }
  catch { console.error('PREVIEW_OPT_IN_REQUIRED'); process.exitCode = 1; }
}
