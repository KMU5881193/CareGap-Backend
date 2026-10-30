import { startLocalDemo } from '../src/demo/be2-local.js';

const demo = await startLocalDemo(process.env);
console.log(`local demo listening on 127.0.0.1:${demo.port}`);
console.log('mode local-demo; restart clears and reloads synthetic rows');
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    demo.close().then(() => process.exit(0), () => process.exit(1));
  });
}
