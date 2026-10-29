import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encodePacket,
  decodePacket,
  buildRecallPresetPacket,
  buildSetMutePacket,
  buildSetGainPercentPacket,
  STX,
  ETX,
  MSG_RECALL_PARAM_PRESET,
  MSG_SET,
  MSG_SET_PERCENT,
} from '../src/protocol/london-di.js';

test('protocol: encodes and decodes roundtrip', () => {
  const body = Buffer.from([0x88, 0x00, 0x01, 0x03, 0x00, 0x01, 0x07, 0x00, 0x04, 0x00, 0x00, 0x00, 0x01]);
  const packet = encodePacket(body);

  assert.equal(packet[0], STX);
  assert.equal(packet[packet.length - 1], ETX);

  const decoded = decodePacket(packet);
  assert.ok(decoded);
  assert.deepEqual(decoded, body);
});

test('protocol: handles byte escaping of special bytes (0x02, 0x03, 0x1B)', () => {
  // Contains STX (0x02), ETX (0x03), ESC (0x1B)
  const body = Buffer.from([0x02, 0x03, 0x1B, 0x55]);
  const packet = encodePacket(body);

  // Decoded must restore the original bytes
  const decoded = decodePacket(packet);
  assert.ok(decoded);
  assert.deepEqual(decoded, body);
});

test('protocol: builds correct preset recall packet', () => {
  const packet = buildRecallPresetPacket(1); // WL Normal Use
  const decoded = decodePacket(packet);
  assert.ok(decoded);
  assert.equal(decoded[0], MSG_RECALL_PARAM_PRESET);
  assert.equal(decoded.readUInt32BE(1), 1);
});

test('protocol: builds correct set mute packet', () => {
  const packet = buildSetMutePacket(4, true); // Channel 4, Muted
  const decoded = decodePacket(packet);
  assert.ok(decoded);
  assert.equal(decoded[0], MSG_SET);
  assert.equal(decoded.readUInt16BE(7), 4); // paramId = channelIndex
  assert.equal(decoded.readUInt32BE(9), 1); // 1 = Muted
});

test('protocol: builds correct set gain percent packet', () => {
  const packet = buildSetGainPercentPacket(0, 75); // Channel 0, 75%
  const decoded = decodePacket(packet);
  assert.ok(decoded);
  assert.equal(decoded[0], MSG_SET_PERCENT);
  assert.equal(decoded.readUInt16BE(7), 32); // paramId = 32 + 0
  const scaled = decoded.readUInt32BE(9);
  const percent = Math.round((scaled / 65536) * 100);
  assert.equal(percent, 75);
});
