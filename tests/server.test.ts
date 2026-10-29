import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { SoundManager } from '../src/manager.js';

test('server: returns health, status, and input profiles', async () => {
  const manager = new SoundManager({ mode: 'simulation', enableAutoPiLoop: false });
  const { app, stop } = createServer({ manager });

  const healthRes = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(healthRes.statusCode, 200);

  const statusRes = await app.inject({ method: 'GET', url: '/api/v1/status' });
  assert.equal(statusRes.statusCode, 200);
  assert.equal(statusRes.json().channels.length, 26);

  const profilesRes = await app.inject({ method: 'GET', url: '/api/v1/profiles' });
  assert.equal(profilesRes.statusCode, 200);
  assert.ok(profilesRes.json().profiles.length >= 8);

  await stop();
});

test('server: assigns profile and updates EQ / AGC via REST', async () => {
  const manager = new SoundManager({ mode: 'simulation', enableAutoPiLoop: false });
  const { app, stop } = createServer({ manager });

  // 1. Assign guitar profile to wired10
  const profileRes = await app.inject({
    method: 'POST',
    url: '/api/v1/mics/wired10/profile',
    payload: { profile: 'guitar' },
  });
  assert.equal(profileRes.statusCode, 200);
  assert.equal(profileRes.json().channel.profile, 'guitar');
  assert.equal(profileRes.json().channel.volumePercent, 70);

  // 2. Set AGC config
  const agcRes = await app.inject({
    method: 'POST',
    url: '/api/v1/mics/kapula1/agc',
    payload: { mode: 'agc-pi', targetDbfs: -20, attackTimeMs: 250 },
  });
  assert.equal(agcRes.statusCode, 200);
  assert.equal(agcRes.json().agc.mode, 'agc-pi');
  assert.equal(agcRes.json().agc.targetDbfs, -20);

  // 3. Set EQ config
  const eqRes = await app.inject({
    method: 'POST',
    url: '/api/v1/mics/kapula1/eq',
    payload: { hpfHz: 90, lowDb: -2.0 },
  });
  assert.equal(eqRes.statusCode, 200);
  assert.equal(eqRes.json().eq.hpfHz, 90);
  assert.equal(eqRes.json().eq.lowDb, -2.0);

  await stop();
});

test('server: supports multi-mix REST routes with Sali toggle and Striimi gain', async () => {
  const manager = new SoundManager({ mode: 'simulation', enableAutoPiLoop: false });
  const { app, stop } = createServer({ manager, enableTelemetry: false });

  // 1. GET /api/v1/mixes
  const mixesRes = await app.inject({ method: 'GET', url: '/api/v1/mixes' });
  assert.equal(mixesRes.statusCode, 200);
  assert.equal(mixesRes.json().mixes.length, 3);

  // 2. GET /api/v1/mixes/sali
  const saliRes = await app.inject({ method: 'GET', url: '/api/v1/mixes/sali' });
  assert.equal(saliRes.statusCode, 200);
  assert.equal(saliRes.json().config.controlType, 'gain');
  assert.equal(saliRes.json().channels.length, 26);

  // 3. POST /api/v1/mixes/sali/channels/kapula1 with enabled: false
  const saliToggleRes = await app.inject({
    method: 'POST',
    url: '/api/v1/mixes/sali/channels/kapula1',
    payload: { enabled: false },
  });
  assert.equal(saliToggleRes.statusCode, 200);
  assert.equal(saliToggleRes.json().send.enabled, false);

  // 4. POST /api/v1/mixes/sali/channels/kapula1 with volumePercent succeeds
  const saliGainRes = await app.inject({
    method: 'POST',
    url: '/api/v1/mixes/sali/channels/kapula1',
    payload: { volumePercent: 78 },
  });
  assert.equal(saliGainRes.statusCode, 200);
  assert.equal(saliGainRes.json().send.volumePercent, 78);

  // 5. POST /api/v1/mixes/striimi/channels/kapula1 with volumePercent should SUCCEED
  const striimiGainRes = await app.inject({
    method: 'POST',
    url: '/api/v1/mixes/striimi/channels/kapula1',
    payload: { volumePercent: 88 },
  });
  assert.equal(striimiGainRes.statusCode, 200);
  assert.equal(striimiGainRes.json().send.volumePercent, 88);

  // 6. Master controls
  const masterVolRes = await app.inject({
    method: 'POST',
    url: '/api/v1/mixes/striimi/master/volume',
    payload: { volumePercent: 92 },
  });
  assert.equal(masterVolRes.statusCode, 200);
  assert.equal(masterVolRes.json().master.volumePercent, 92);

  const masterMuteRes = await app.inject({
    method: 'POST',
    url: '/api/v1/mixes/striimi/master/mute',
    payload: { muted: true },
  });
  assert.equal(masterMuteRes.statusCode, 200);
  assert.equal(masterMuteRes.json().master.isMuted, true);

  await stop();
});
