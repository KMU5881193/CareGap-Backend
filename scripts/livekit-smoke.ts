import 'dotenv/config';
import { LiveKitProvider, parseLiveKitConfig } from '../src/modules/be2-calls/livekit-provider.js';

async function main(): Promise<void> {
  const cfg = parseLiveKitConfig(process.env);
  if (!cfg) {
    console.log('LIVEKIT_SMOKE=CONFIG_MISSING');
    return;
  }

  const media = new LiveKitProvider(cfg);
  const room = `cg_smoke_${Math.random().toString(36).slice(2)}`;
  await media.ensureRoom(room, 2);
  const issued = await media.createJoinToken({
    roomName: room,
    identity: 'caller_smoke',
    ttlSeconds: 120,
  });
  const payload = JSON.parse(Buffer.from(issued.token.split('.')[1]!, 'base64url').toString('utf8')) as {
    exp?: number;
    video?: Record<string, unknown>;
  };
  const video = payload.video ?? {};
  console.log('LIVEKIT_SMOKE=OK');
  console.log(JSON.stringify({
    roomJoin: video.roomJoin === true,
    roomMatch: video.room === room,
    canPublish: video.canPublish === true,
    canSubscribe: video.canSubscribe === true,
    roomAdminFalse: video.roomAdmin === false || video.roomAdmin == null,
    roomRecordFalse: video.roomRecord === false || video.roomRecord == null,
    canPublishSources: video.canPublishSources,
    ttlOk: typeof payload.exp === 'number',
  }));
  await media.deleteRoom(room);
}

main().catch((error) => {
  console.error('LIVEKIT_SMOKE=FAIL');
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
