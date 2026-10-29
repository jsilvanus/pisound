import test from 'node:test';
import assert from 'node:assert/strict';
import { SoundManager } from '../src/manager.js';

test('manager: initial state has 26 channels (4 handheld, 10 madonna, 12 wired)', () => {
  const manager = new SoundManager({ mode: 'simulation' });
  const snapshot = manager.getSnapshot();

  assert.equal(snapshot.channels.length, 26);
  assert.equal(snapshot.channels.filter((c) => c.group === 'handheld').length, 4);
  assert.equal(snapshot.channels.filter((c) => c.group === 'madonna').length, 10);
  assert.equal(snapshot.channels.filter((c) => c.group === 'wired').length, 12);
  assert.equal(snapshot.activeWirelessCount, 1); // Kapula 1 default ON

  manager.close();
});

test('manager: toggling and setting mic states', () => {
  const manager = new SoundManager({ mode: 'simulation' });

  // Turn ON Madonna 1
  const madonna1 = manager.setMicState('madonna1', true);
  assert.equal(madonna1.isOn, true);

  // Toggle Kapula 1 (default was ON -> now OFF)
  const kapula1 = manager.toggleMic('kapula1');
  assert.equal(kapula1.isOn, false);

  manager.close();
});

test('manager: soloing wireless mic mutes all other wireless mics', () => {
  const manager = new SoundManager({ mode: 'simulation' });

  // Turn on Kapula 2 and Kapula 3
  manager.setMicState('kapula2', true);
  manager.setMicState('kapula3', true);
  assert.equal(manager.getChannel('kapula2')?.isOn, true);
  assert.equal(manager.getChannel('kapula3')?.isOn, true);

  // Solo Madonna 1 (e.g. sermon starts)
  manager.soloMic('madonna1');

  assert.equal(manager.getChannel('madonna1')?.isOn, true);
  assert.equal(manager.getChannel('kapula1')?.isOn, false);
  assert.equal(manager.getChannel('kapula2')?.isOn, false);
  assert.equal(manager.getChannel('kapula3')?.isOn, false);
  assert.equal(manager.getChannel('madonna2')?.isOn, false);

  // Wired mics should NOT have been affected by wireless solo
  assert.equal(manager.getChannel('wired1')?.isOn, true);

  manager.close();
});

test('manager: bulk mute and unmute of wireless group', () => {
  const manager = new SoundManager({ mode: 'simulation' });

  manager.setMicState('kapula1', true);
  manager.setMicState('madonna1', true);

  // Bulk mute wireless
  manager.muteGroup('wireless');
  const snap1 = manager.getSnapshot();
  assert.equal(snap1.activeWirelessCount, 0);

  // Bulk unmute wireless
  manager.unmuteGroup('wireless');
  const snap2 = manager.getSnapshot();
  assert.equal(snap2.activeWirelessCount, 14);

  manager.close();
});

test('manager: preset recall changes active preset', () => {
  const manager = new SoundManager({ mode: 'simulation' });

  assert.equal(manager.getSnapshot().currentPreset.key, 'normal');

  const preset = manager.recallPreset('mixer');
  assert.equal(preset.key, 'mixer');
  assert.equal(preset.id, 0);
  assert.equal(manager.getSnapshot().currentPreset.key, 'mixer');

  manager.close();
});
