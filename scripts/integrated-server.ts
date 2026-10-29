import { createIntegratedApp } from '../src/integrated-app.js';
import { parseServerConfig } from '../src/config.js';
const config = parseServerConfig(process.env);
const app = createIntegratedApp(process.env);
const host = process.env.API_HOST ?? '127.0.0.1';
if (!['127.0.0.1','0.0.0.0'].includes(host)) throw new Error('INVALID_API_HOST');
const server = app.listen(config.PORT, host, () => console.log(`Integrated API: http://${host}:${config.PORT}`));
for (const signal of ['SIGTERM','SIGINT'] as const) process.on(signal, () => server.close());
