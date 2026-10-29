import test from 'node:test';
import assert from 'node:assert/strict';
import { SoundManager } from '../src/manager.js';

test('manager: initial state has 26 channels (4 handheld, 10 madonna, 12 wired)', () => {
  const manager = new SoundManager({ mode: 'simulation', enableAutoPiLoop: false });
  const snapshot = manager.getSnapshot();

  assert.equal(snapshot.channels.length, 26);
  assert.equal(snapshot.channels.filter((c) => c.group === 'handheld').length, 4);
  assert.equal(snapshot.channels.filter((c) => c.group === 'madonna').length, 10);
  assert.equal(snapshot.channels.filter((c) => c.group === 'wired').length, 12);
  assert.equal(snapshot.activeWirelessCount, 1); // Kapula 1 default ON

  // Verify profile defaults
  const kapula1 = manager.getChannel('kapula1')!;
  assert.equal(kapula1.profile, 'speech');
  assert.equal(kapula1.eq.hpfEnabled, true);
  assert.equal(kapula1.eq.hpfHz, 80);
  assert.equal(kapula1.agc.mode, 'agc-pi');

  manager.close();
});

test('manager: toggling and setting mic states', () => {
  const manager = new SoundManager({ mode: 'simulation', enableAutoPiLoop: false });

  // Turn ON Madonna 1
  const madonna1 = manager.setMicState('madonna1', true);
  assert.equal(madonna1.isOn, true);

  // Toggle Kapula 1 (default was ON -> now OFF)
  const kapula1 = manager.toggleMic('kapula1');
  assert.equal(kapula1.isOn, false);

  manager.close();
});

test('manager: soloing wireless mic mutes all other wireless mics', () => {
  const manager = new SoundManager({ mode: 'simulation', enableAutoPiLoop: false });

  manager.setMicState('kapula2', true);
  manager.setMicState('kapula3', true);
  assert.equal(manager.getChannel('kapula2')?.isOn, true);
  assert.equal(manager.getChannel('kapula3')?.isOn, true);

  // Solo Madonna 1
  manager.soloMic('madonna1');

  assert.equal(manager.getChannel('madonna1')?.isOn, true);
  assert.equal(manager.getChannel('kapula1')?.isOn, false);
  assert.equal(manager.getChannel('kapula2')?.isOn, false);
  assert.equal(manager.getChannel('kapula3')?.isOn, false);
  assert.equal(manager.getChannel('madonna2')?.isOn, false);

  // Wired mics unaffected
  assert.equal(manager.getChannel('wired1')?.isOn, true);

  manager.close();
});

test('manager: assigning input profile snaps fader, EQ, and AGC settings', () => {
  const manager = new SoundManager({ mode: 'simulation', enableAutoPiLoop: false });

  // Change floor box wired10 to guitar profile
  const updated = manager.setChannelProfile('wired10', 'guitar');
  assert.equal(updated.profile, 'guitar');
  assert.equal(updated.volumePercent, 70);
  assert.equal(updated.eq.hpfHz, 50);
  assert.equal(updated.eq.midDb, -2.0);
  assert.equal(updated.agc.mode, 'none');

  // Change kapula3 to choir profile
  const choirMic = manager.setChannelProfile('kapula3', 'choir');
  assert.equal(choirMic.profile, 'choir');
  assert.equal(choirMic.volumePercent, 68);
  assert.equal(choirMic.eq.hpfHz, 60);

  manager.close();
});

test('manager: custom EQ and AGC adjustments', () => {
  const manager = new SoundManager({ mode: 'simulation', enableAutoPiLoop: false });

  // Adjust EQ
  const eqUpdated = manager.setChannelEq('kapula1', { hpfHz: 100, midDb: 3.5 });
  assert.equal(eqUpdated.eq.hpfHz, 100);
  assert.equal(eqUpdated.eq.midDb, 3.5);

  // Adjust AGC parameters
  const agcUpdated = manager.setChannelAgc('kapula1', {
    mode: 'agc-pi',
    targetDbfs: -20,
    attackTimeMs: 250,
    maxBoostDb: 5,
  });
  assert.equal(agcUpdated.agc.targetDbfs, -20);
  assert.equal(agcUpdated.agc.attackTimeMs, 250);
  assert.equal(agcUpdated.agc.maxBoostDb, 5);

  manager.close();
});

test('manager: auto-pi fader rider logic (quiet voice, loud voice, and silence freeze)', () => {
  const manager = new SoundManager({ mode: 'simulation', enableAutoPiLoop: false });

  const mic = manager.getChannel('kapula1')!;
  assert.equal(mic.isOn, true);
  assert.equal(mic.agc.mode, 'agc-pi');
  const initialVol = mic.volumePercent; // 75%

  // 1. Silent room (peak = -55 dBFS, below noise gate -42 dBFS) -> Fader must freeze
  manager.updateChannelMeter('kapula1', -55);
  manager.tickAutoPi(100);
  assert.equal(mic.volumePercent, initialVol); // No change

  // 2. Quiet voice speaking (peak = -30 dBFS, target is -22 dBFS) -> Error is +8 dB -> Fader ramps UP
  manager.updateChannelMeter('kapula1', -30);
  // Tick forward 500 ms (5 x 100ms)
  for (let i = 0; i < 5; i++) {
    manager.tickAutoPi(100);
  }
  assert.ok(mic.volumePercent > initialVol, `Expected volume > ${initialVol}, got ${mic.volumePercent}`);

  // 3. Loud voice speaking (peak = -14 dBFS, target is -22 dBFS) -> Error is -8 dB -> Fader ramps DOWN
  const boostedVol = mic.volumePercent;
  manager.updateChannelMeter('kapula1', -14);
  for (let i = 0; i < 5; i++) {
    manager.tickAutoPi(100);
  }
  assert.ok(mic.volumePercent < boostedVol, `Expected volume < ${boostedVol}, got ${mic.volumePercent}`);

  manager.close();
});
