import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { SoundwebClient } from '../src/soundweb/client.js';

async function freePort(): Promise<number> {
  const srv = net.createServer();
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const port = (srv.address() as net.AddressInfo).port;
  await new Promise((r) => srv.close(r));
  return port;
}

test('soundweb client: offline DSP does not throw, reports disconnected, reconnects later', async () => {
  const port = await freePort();
  const client = new SoundwebClient({ host: '127.0.0.1', port, reconnectIntervalMs: 50 });
  await new Promise((r) => setTimeout(r, 200));
  assert.notEqual(client.getStatus(), 'connected');
  assert.ok(client.lastError);

  const srv = net.createServer((s) => s.on('error', () => {}));
  await new Promise<void>((r) => srv.listen(port, '127.0.0.1', r));
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(client.getStatus(), 'connected');
  assert.equal(client.lastError, null);

  client.destroy();
  srv.closeAllConnections?.();
  await new Promise((r) => srv.close(r));
});
