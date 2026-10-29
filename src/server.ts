import {createApp} from './app.js';
import {parseServerConfig} from './config.js';
const config=parseServerConfig(process.env);
const server=createApp(config).listen(config.PORT,'127.0.0.1',()=>console.log('CareGap API on port '+config.PORT));
for(const signal of ['SIGTERM','SIGINT'] as const) process.on(signal,()=>server.close());
