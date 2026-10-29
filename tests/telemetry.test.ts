import test from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { SoundManager } from '../src/manager.js';
import {
  decodePisoundTelemetryPacket,
  encodePisoundTelemetryPacket,
  TELEMETRY_MAGIC,
  TELEMETRY_VERSION,
  type PisoundTelemetryPayload,
} from '../src/telemetry/packet.js';
import { TelemetrySender } from '../src/telemetry/sender.js';

test('telemetry: binary packet roundtrip with all 26 channels and multiple mixes', () => {
  const manager = new SoundManager({ mode: 'simulation', enableAutoPiLoop: false });

  // Update a few channels to simulate active speech and different levels
  manager.updateChannelMeter('kapula1', -18.5); // Speech active
  manager.updateChannelMeter('kapula2', -24.0);
  manager.setMixChannel('striimi', 'kapula1', { volumePercent: 82 });
  manager.setMixChannel('webradio', 'kapula1', { volumePercent: 79 });

  const sender = new TelemetrySender(manager);
  const payload = sender.buildPayload();

  assert.equal(payload.channels.length, 26);
  assert.equal(payload.mixes.length, 3);

  // Encode to binary buffer
  const packet = encodePisoundTelemetryPacket(payload);
  assert.ok(Buffer.isBuffer(packet));
  assert.ok(packet.length > 200 && packet.length < 500); // Verify compact size (< 500 bytes)

  // Decode back
  const decoded = decodePisoundTelemetryPacket(packet);
  assert.ok(decoded);
  assert.equal(decoded.sequence, payload.sequence);
  assert.equal(decoded.timestamp, payload.timestamp);
  assert.equal(decoded.mixes.length, 3);
  assert.equal(decoded.channels.length, 26);

  // Check mix summary
  const saliMix = decoded.mixes.find((m) => m.id === 'sali')!;
  assert.equal(saliMix.controlType, 'toggle');
  const striimiMix = decoded.mixes.find((m) => m.id === 'striimi')!;
  assert.equal(striimiMix.controlType, 'gain');

  // Check kapula1 channel record
  const kapula1 = decoded.channels.find((c) => c.channelIndex === 0)!;
  assert.ok(kapula1);
  assert.equal(kapula1.profile, 'speech');
  assert.equal(kapula1.signalPresent, true);
  assert.equal(kapula1.peakMilliDbfs, -18500); // -18.5 dBFS in milli-dBFS
  assert.equal(kapula1.mixSends['striimi']?.volumePercent, 82);
  assert.equal(kapula1.mixSends['webradio']?.volumePercent, 79);

  // Check ambient mic (wired12)
  const wired12 = decoded.channels.find((c) => c.channelIndex === 25)!;
  assert.ok(wired12);
  assert.equal(wired12.mixSends['sali']?.enabled, false);
  assert.equal(wired12.mixSends['striimi']?.enabled, true);
});

test('telemetry: active talkers 32-bit mask reflects speech channels', () => {
  const manager = new SoundManager({ mode: 'simulation', enableAutoPiLoop: false });

  // kapula1 is channelIndex 0
  manager.updateChannelMeter('kapula1', -15.0); // signalPresent = true

  // madonna1 is channelIndex 4
  manager.updateChannelMeter('madonna1', -18.0); // signalPresent = true

  const sender = new TelemetrySender(manager);
  const payload = sender.buildPayload();

  // Bit 0 and Bit 4 should be 1
  const expectedMask = (1 << 0) | (1 << 4);
  assert.equal((payload.activeTalkersMask & expectedMask), expectedMask);

  // Channel 1 should be 0
  assert.equal(payload.activeTalkersMask & (1 << 1), 0);
});

test('telemetry: TelemetrySender sends UDP datagrams to configured port', async () => {
  const testPort = 13102;
  const manager = new SoundManager({ mode: 'simulation', enableAutoPiLoop: false });

  // Create a test UDP receiver socket
  const receiver = dgram.createSocket('udp4');
  await new Promise<void>((resolve) => receiver.bind(testPort, '127.0.0.1', resolve));

  const receivedPackets: Buffer[] = [];
  receiver.on('message', (msg) => {
    receivedPackets.push(msg);
  });

  const sender = new TelemetrySender(manager, {
    host: '127.0.0.1',
    port: testPort,
    intervalMs: 50,
  });

  sender.start();

  // Wait 120 ms to allow 2 ticks
  await new Promise((r) => setTimeout(r, 120));

  sender.stop();
  receiver.close();

  assert.ok(receivedPackets.length >= 1, `Expected at least 1 UDP packet, received ${receivedPackets.length}`);
  const first = receivedPackets[0]!;
  const parsed = decodePisoundTelemetryPacket(first);
  assert.ok(parsed);
  assert.equal(parsed.channels.length, 26);
  assert.equal(parsed.mixes.length, 3);
});
