import { createServer } from './server.js';

async function main() {
  const { start } = createServer();
  const url = await start();
  console.log(`[PISOUND] Sound controller service running at ${url}`);
  console.log(`[PISOUND] Mode: ${process.env.PISOUND_MODE || 'simulation'}`);
  console.log(`[PISOUND] Soundweb target: ${process.env.PISOUND_SOUNDWEB_HOST || '192.168.1.30'}:${process.env.PISOUND_SOUNDWEB_PORT || 1023}`);
}

main().catch((err) => {
  console.error('[PISOUND] Fatal startup error:', err);
  process.exit(1);
});
