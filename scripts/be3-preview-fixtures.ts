import request from 'supertest';
import { pathToFileURL } from 'node:url';
import { createPreviewApp } from './be3-preview-server.js';

// Offline HTTP contract capture with a fresh in-memory synthetic scenario.
export async function capturePreviewFixtures() {
  const app = createPreviewApp('1');
  const screens: Record<string, unknown> = {};
  async function post(path: string, body: object) {
    const response = await request(app).post(`/preview/${path}`).send(body);
    if (response.status >= 400) throw new Error('SYNTHETIC_CAPTURE_FAILED');
    return response.body;
  }
  async function ready(kind: 'ocr' | 'stt') {
    for (let i = 0; i < 100; i++) {
      const r = await request(app).get(`/preview/${kind}/result`);
      if (r.body.data?.status === 'succeeded') return r.body;
      await new Promise(resolve => setTimeout(resolve, 2));
    }
    throw new Error('SYNTHETIC_CAPTURE_TIMEOUT');
  }
  screens.scenario = (await request(app).get('/preview/scenario')).body;
  for (const kind of ['ocr', 'stt'] as const) {
    await post(`${kind}/jobs`, {}); screens[`${kind}_original`] = await ready(kind);
    screens[`${kind}_corrected`] = await post(`${kind}/corrections`, { expected_version: 0 });
    screens[`${kind}_confirmed`] = await post(`${kind}/confirmation`, { expected_version: 1 });
  }
  screens.analysis_draft = await post('analyses', { source: 'ocr' });
  screens.analysis_edited = await post('analysis/reviews', { action: 'edit', expected_version: 1 });
  screens.analysis_review = await post('analysis/reviews', { action: 'submit', expected_version: 2 });
  screens.analysis_approved = await post('analysis/reviews', { action: 'approve', expected_version: 3 });
  screens.published = (await request(app).get('/preview/analysis/published')).body;
  screens.needs_confirmed = await post('needs/confirmation', { needs: ['meal_support', 'mobility_support', 'medication_management'], confirmed: true });
  screens.welfare_cards = await post('welfare-recommendations', {});
  return { fixture_origin: 'captured_from_synthetic_preview_services', demo_mode: true, data_origin: 'synthetic', screens };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await capturePreviewFixtures(), null, 2));
}
