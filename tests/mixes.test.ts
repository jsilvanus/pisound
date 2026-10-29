import test from 'node:test';
import assert from 'node:assert/strict';
import { SoundManager } from '../src/manager.js';
import type { AudioMixConfig } from '../src/types.js';

test('mixes: default configuration contains Sali (PA), Striimi, and Web Radio', () => {
  const manager = new SoundManager({ mode: 'simulation', enableAutoPiLoop: false });
  const mixes = manager.getMixes();

  assert.equal(mixes.length, 3);
  const sali = mixes.find((m) => m.id === 'sali')!;
  const striimi = mixes.find((m) => m.id === 'striimi')!;
  const webradio = mixes.find((m) => m.id === 'webradio')!;

  assert.ok(sali);
  assert.equal(sali.controlType, 'gain'); // Full fader gain + mute matching iPad

  assert.ok(striimi);
  assert.equal(striimi.controlType, 'gain'); // Full fader gain + mute

  assert.ok(webradio);
  assert.equal(webradio.controlType, 'gain'); // Full fader gain + mute
});

test('mixes: allows configurable custom mixes (e.g. 4 mixes with videochat)', () => {
  const customMixes: AudioMixConfig[] = [
    {
      id: 'pa',
      name: 'Sanctuary PA',
      controlType: 'toggle',
      hasMasterFader: true,
      defaultMasterVolume: 80,
      defaultEnabled: true,
    },
    {
      id: 'stream',
      name: 'YouTube Stream',
      controlType: 'gain',
      hasMasterFader: true,
      defaultMasterVolume: 85,
      defaultEnabled: true,
    },
    {
      id: 'radio',
      name: 'Web Radio',
      controlType: 'gain',
      hasMasterFader: true,
      defaultMasterVolume: 80,
      defaultEnabled: true,
    },
    {
      id: 'videochat',
      name: 'VideoChat Mix-Minus',
      controlType: 'gain',
      hasMasterFader: true,
      defaultMasterVolume: 75,
      defaultEnabled: true,
    },
  ];

  const manager = new SoundManager({
    mode: 'simulation',
    enableAutoPiLoop: false,
    mixes: customMixes,
  });

  const mixes = manager.getMixes();
  assert.equal(mixes.length, 4);
  assert.ok(mixes.find((m) => m.id === 'videochat'));

  const snapshot = manager.getSnapshot();
  assert.equal(snapshot.mixes.length, 4);
  assert.ok(snapshot.mixes.find((m) => m.id === 'videochat'));
});

test('mixes: Sali has independent per-channel faders and mute toggles matching iPad', () => {
  const manager = new SoundManager({ mode: 'simulation', enableAutoPiLoop: false });

  // Setting Sali gain to 82% works
  const send1 = manager.setMixChannel('sali', 'kapula1', { enabled: true, volumePercent: 82 });
  assert.equal(send1.enabled, true);
  assert.equal(send1.volumePercent, 82);

  // Muting in Sali works
  const send2 = manager.setMixChannel('sali', 'kapula1', { enabled: false });
  assert.equal(send2.enabled, false);
  assert.equal(send2.volumePercent, 82);

  // Custom toggle-only mix rejects volumePercent
  const customToggleManager = new SoundManager({
    mode: 'simulation',
    enableAutoPiLoop: false,
    mixes: [{ id: 'relay', name: 'Relay', controlType: 'toggle', hasMasterFader: false, defaultMasterVolume: 80, defaultEnabled: true }],
  });
  assert.throws(
    () => {
      customToggleManager.setMixChannel('relay', 'kapula1', { volumePercent: 50 });
    },
    /toggle mix \(on\/off routing only\); per-channel gain faders are not supported/
  );
});

test('mixes: Striimi and Web Radio allow per-channel fader gain and mute', () => {
  const manager = new SoundManager({ mode: 'simulation', enableAutoPiLoop: false });

  // Set Striimi gain to 65%
  const sendStriimi = manager.setMixChannel('striimi', 'kapula2', {
    enabled: true,
    volumePercent: 65,
  });
  assert.equal(sendStriimi.enabled, true);
  assert.equal(sendStriimi.volumePercent, 65);

  // Set Web Radio gain to 50%
  const sendRadio = manager.setMixChannel('webradio', 'kapula2', {
    enabled: true,
    volumePercent: 50,
  });
  assert.equal(sendRadio.enabled, true);
  assert.equal(sendRadio.volumePercent, 50);

  // Verify they maintain independent levels
  const ch = manager.getChannel('kapula2')!;
  assert.equal(ch.mixes['striimi']?.volumePercent, 65);
  assert.equal(ch.mixes['webradio']?.volumePercent, 50);
});

test('mixes: ambient room mic (wired12 Parvi) acoustic rules', () => {
  const manager = new SoundManager({ mode: 'simulation', enableAutoPiLoop: false });
  const ambient = manager.getChannel('wired12')!;

  // Must be OFF in Sali by default (protects sanctuary speakers from feedback)
  assert.equal(ambient.mixes['sali']?.enabled, false);

  // Must be ON in Striimi (provides congregation presence & organ acoustics)
  assert.equal(ambient.mixes['striimi']?.enabled, true);
  assert.ok(ambient.mixes['striimi']!.volumePercent > 0);

  // When soloing a speech mic, ambient stays active in striimi!
  manager.soloMic('madonna1');

  const madonna1 = manager.getChannel('madonna1')!;
  assert.equal(madonna1.mixes['sali']?.enabled, true);
  assert.equal(madonna1.mixes['striimi']?.enabled, true);

  // Ambient mic is still enabled on stream!
  assert.equal(ambient.mixes['striimi']?.enabled, true);
  // And still disabled in Sali
  assert.equal(ambient.mixes['sali']?.enabled, false);
});

test('mixes: master volume and master mute controls', () => {
  const manager = new SoundManager({ mode: 'simulation', enableAutoPiLoop: false });

  // Sali master
  const saliMaster = manager.setMixMasterVolume('sali', 70);
  assert.equal(saliMaster.volumePercent, 70);

  const saliMute = manager.setMixMasterMute('sali', true);
  assert.equal(saliMute.isMuted, true);

  // Striimi master
  const striimiMaster = manager.setMixMasterVolume('striimi', 90);
  assert.equal(striimiMaster.volumePercent, 90);

  const striimiMute = manager.setMixMasterMute('striimi', false);
  assert.equal(striimiMute.isMuted, false);

  const states = manager.getMixMasterStates();
  const s = states.find((m) => m.id === 'sali')!;
  assert.equal(s.volumePercent, 70);
  assert.equal(s.isMuted, true);
});
