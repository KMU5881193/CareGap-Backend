import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { parseConfig } from '../src/config.js';
describe('unconfigured legacy authorization fails closed', () => {
 for (const path of ['/api/auth/staff/pending', '/api/auth/staff/approve', '/api/relationships', '/api/consultations/records', '/api/welfare']) {
  it(path, async () => {
   const app = createApp(parseConfig({NODE_ENV:'production'}));
   expect((await request(app).get(path)).status).toBe(503);
   expect((await request(app).post(path).send({})).status).toBe(503);
  });
 }
});
