import express from 'express';
import { createApp } from '../src/app.js';
import { parseServerConfig } from '../src/config.js';
import { createPreviewApp } from './be3-preview-server.js';
const config = parseServerConfig(process.env);
const app = express();
if (process.env.CAREGAP_SYNTHETIC_PREVIEW === '1') {
 if (config.NODE_ENV === 'production') throw new Error('Synthetic preview is forbidden in production');
 app.use('/preview', (req, res, next) => { req.url = '/preview' + req.url; preview(req,res,next); });
}
const preview = process.env.CAREGAP_SYNTHETIC_PREVIEW === '1' ? createPreviewApp('1') : express();
app.use(createApp(config));
const server = app.listen(config.PORT, '127.0.0.1', () => console.log(`Integrated API: http://127.0.0.1:${config.PORT}`));
for (const signal of ['SIGTERM','SIGINT'] as const) process.on(signal, () => server.close());
