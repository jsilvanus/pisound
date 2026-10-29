import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { SoundManager } from '../src/manager.js';

test('server: returns health and status', async () => {
  const manager = new SoundManager({ mode: 'simulation' });
  const { app, stop } = createServer({ manager });

  const healthRes = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(healthRes.statusCode, 200);
  assert.equal(healthRes.json().status, 'ok');

  const statusRes = await app.inject({ method: 'GET', url: '/api/v1/status' });
  assert.equal(statusRes.statusCode, 200);
  const status = statusRes.json();
  assert.equal(status.service, 'pisound');
  assert.equal(status.channels.length, 26);

  await stop();
});

test('server: controls mic state and volume over REST', async () => {
  const manager = new SoundManager({ mode: 'simulation' });
  const { app, stop } = createServer({ manager });

  // Set madonna1 ON
  const stateRes = await app.inject({
    method: 'POST',
    url: '/api/v1/mics/madonna1/state',
    payload: { on: true },
  });
  assert.equal(stateRes.statusCode, 200);
  assert.equal(stateRes.json().channel.isOn, true);

  // Set volume
  const volRes = await app.inject({
    method: 'POST',
    url: '/api/v1/mics/madonna1/volume',
    payload: { volumePercent: 88 },
  });
  assert.equal(volRes.statusCode, 200);
  assert.equal(volRes.json().channel.volumePercent, 88);

  // Solo madonna1
  const soloRes = await app.inject({
    method: 'POST',
    url: '/api/v1/mics/madonna1/solo',
  });
  assert.equal(soloRes.statusCode, 200);
  assert.equal(soloRes.json().solo, 'madonna1');

  // Kapula 1 should now be false
  const kapRes = await app.inject({ method: 'GET', url: '/api/v1/mics/kapula1' });
  assert.equal(kapRes.json().isOn, false);

  await stop();
});

test('server: preset recall endpoint', async () => {
  const manager = new SoundManager({ mode: 'simulation' });
  const { app, stop } = createServer({ manager });

  const presetRes = await app.inject({
    method: 'POST',
    url: '/api/v1/presets/mixer',
  });
  assert.equal(presetRes.statusCode, 200);
  assert.equal(presetRes.json().preset.id, 0);

  await stop();
});
