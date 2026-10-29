import assert from 'node:assert/strict';
import test from 'node:test';
import { SoundManager } from '../src/manager.js';
import { createServer } from '../src/server.js';

test('resetToDefaults restores all channels, mutes, and master mixes to church baseline', () => {
  const manager = new SoundManager({ mode: 'simulation' });

  // Modify multiple channels and masters
  manager.setMicVolume('kapula1', 95);
  manager.setMicState('kapula1', false); // mute kapula 1
  manager.setMicVolume('madonna1', 88);
  manager.setMicState('madonna1', true); // unmute madonna 1
  manager.setMixMasterVolume('sali', 40);
  manager.setMixMasterMute('sali', true);
  manager.setMixMasterVolume('webradio', 50);

  // Assert modified state
  assert.equal(manager.getChannel('kapula1')?.volumePercent, 95);
  assert.equal(manager.getChannel('kapula1')?.isOn, false);
  assert.equal(manager.getMixMasterState('sali')?.volumePercent, 40);
  assert.equal(manager.getMixMasterState('sali')?.isMuted, true);

  // Reset to church defaults
  const snapshot = manager.resetToDefaults();
  assert.ok(snapshot);

  // Assert restored state
  // Kapula 1: 75% volume, unmuted (isDefaultOn = true)
  assert.equal(manager.getChannel('kapula1')?.volumePercent, 75);
  assert.equal(manager.getChannel('kapula1')?.isOn, true);

  // Madonna 1: 75% volume, muted (isDefaultOn = false)
  assert.equal(manager.getChannel('madonna1')?.volumePercent, 75);
  assert.equal(manager.getChannel('madonna1')?.isOn, false);

  // Parvi ambient (wired12): 0% in Sali (PA feedback guard), 52% in Striimi
  assert.equal(manager.getChannel('wired12')?.mixes['sali']?.volumePercent, 0);
  assert.equal(manager.getChannel('wired12')?.mixes['sali']?.enabled, false);
  assert.equal(manager.getChannel('wired12')?.mixes['striimi']?.volumePercent, 52);
  assert.equal(manager.getChannel('wired12')?.mixes['striimi']?.enabled, true);

  // Master outputs restored
  assert.equal(manager.getMixMasterState('sali')?.volumePercent, 80);
  assert.equal(manager.getMixMasterState('sali')?.isMuted, false);
  assert.equal(manager.getMixMasterState('striimi')?.volumePercent, 85);
  assert.equal(manager.getMixMasterState('striimi')?.isMuted, false);
  assert.equal(manager.getMixMasterState('webradio')?.volumePercent, 80);
  assert.equal(manager.getMixMasterState('webradio')?.isMuted, false);

  manager.close();
});

test('POST /api/v1/reset resets mixer via HTTP', async () => {
  const manager = new SoundManager({ mode: 'simulation' });
  const { app } = createServer({ manager, enableTelemetry: false });

  // Alter a channel
  manager.setMicVolume('kapula1', 30);
  assert.equal(manager.getChannel('kapula1')?.volumePercent, 30);

  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/reset',
  });

  assert.equal(res.statusCode, 200);
  const json = res.json();
  assert.equal(json.ok, true);
  assert.equal(json.snapshot.service, 'pisound');
  assert.equal(manager.getChannel('kapula1')?.volumePercent, 75);

  manager.close();
  await app.close();
});
