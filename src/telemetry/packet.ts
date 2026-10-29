/**
 * Binary UDP Telemetry Packet Encoder & Decoder for pisound.
 *
 * Wire format v1 (Magic: 'PS', port: 3102 by default):
 * - Designed for ultra-low latency (< 100 ms cadence) broadcast to pigateway / picontrol.
 * - Dynamically supports configurable number of mixes (e.g. Sali, Striimi, WebRadio, VideoChat).
 * - Delivers real-time VU meter peaks, speech activity, and per-mix routing/faders for all 26 channels.
 */

import type { InputProfileId, MixControlType } from '../types.js';

export const TELEMETRY_MAGIC = 0x5053; // ASCII 'PS'
export const TELEMETRY_VERSION = 1;
export const TELEMETRY_TYPE_SNAPSHOT = 0x01;

const PROFILE_INDEX_MAP: Record<InputProfileId, number> = {
  speech: 0,
  vocal: 1,
  guitar: 2,
  piano: 3,
  choir: 4,
  organ: 5,
  drums: 6,
  ambient: 7,
  custom: 8,
};

const INDEX_PROFILE_MAP: Record<number, InputProfileId> = {
  0: 'speech',
  1: 'vocal',
  2: 'guitar',
  3: 'piano',
  4: 'choir',
  5: 'organ',
  6: 'drums',
  7: 'ambient',
  8: 'custom',
};

export interface TelemetryMixSummary {
  id: string;
  controlType: MixControlType;
  masterVolume: number; // 0..100
  masterMuted: boolean;
}

export interface TelemetryChannelInput {
  channelIndex: number;
  peakMilliDbfs: number; // e.g. -22000 for -22.0 dBFS
  profile: InputProfileId;
  signalPresent: boolean;
  agcActive: boolean;
  isOn: boolean;
  mixSends: Record<string, { enabled: boolean; volumePercent: number }>;
}

export interface PisoundTelemetryPayload {
  sequence: number;
  timestamp: number; // Unix ms
  activeTalkersMask: number; // 32-bit bitmask of channels with active speech
  mixes: TelemetryMixSummary[];
  channels: TelemetryChannelInput[];
}

/**
 * Encodes a telemetry snapshot into a binary Buffer.
 */
export function encodePisoundTelemetryPacket(payload: PisoundTelemetryPayload): Buffer {
  const mixCount = payload.mixes.length;
  const channelCount = payload.channels.length;

  // Calculate required buffer length
  // Header: 2 (Magic) + 1 (Ver) + 1 (Type) + 2 (Flags) + 4 (Seq) + 8 (Ts) + 1 (MixCnt) + 1 (ChCnt) + 4 (Mask) = 24 bytes
  let size = 24;

  // Mix metadata: 1 (idLen) + idLen + 1 (controlType) + 1 (masterVol) + 1 (masterMuted)
  const mixIdBuffers = payload.mixes.map((m) => Buffer.from(m.id, 'utf8'));
  for (let i = 0; i < mixCount; i++) {
    size += 1 + mixIdBuffers[i]!.length + 3;
  }

  // Channels: channelCount * (1 (idx) + 4 (peak) + 1 (prof) + 1 (flags) + mixCount * 1 (send byte))
  const channelRecordSize = 1 + 4 + 1 + 1 + mixCount;
  size += channelCount * channelRecordSize;

  const buf = Buffer.alloc(size);
  let offset = 0;

  // 1. Header (24 bytes)
  buf.writeUInt16BE(TELEMETRY_MAGIC, offset);
  offset += 2;
  buf.writeUInt8(TELEMETRY_VERSION, offset);
  offset += 1;
  buf.writeUInt8(TELEMETRY_TYPE_SNAPSHOT, offset);
  offset += 1;
  buf.writeUInt16BE(0, offset); // Flags reserved
  offset += 2;
  buf.writeUInt32BE(payload.sequence >>> 0, offset);
  offset += 4;
  buf.writeBigUInt64BE(BigInt(payload.timestamp), offset);
  offset += 8;
  buf.writeUInt8(mixCount, offset);
  offset += 1;
  buf.writeUInt8(channelCount, offset);
  offset += 1;
  buf.writeUInt32BE(payload.activeTalkersMask >>> 0, offset);
  offset += 4;

  // 2. Mix Metadata
  for (let i = 0; i < mixCount; i++) {
    const mix = payload.mixes[i]!;
    const idBuf = mixIdBuffers[i]!;
    buf.writeUInt8(idBuf.length, offset);
    offset += 1;
    idBuf.copy(buf, offset);
    offset += idBuf.length;

    buf.writeUInt8(mix.controlType === 'gain' ? 1 : 0, offset);
    offset += 1;
    buf.writeUInt8(Math.max(0, Math.min(100, Math.round(mix.masterVolume))), offset);
    offset += 1;
    buf.writeUInt8(mix.masterMuted ? 1 : 0, offset);
    offset += 1;
  }

  // 3. Channels
  for (const ch of payload.channels) {
    buf.writeUInt8(ch.channelIndex, offset);
    offset += 1;
    buf.writeInt32BE(ch.peakMilliDbfs, offset);
    offset += 4;

    const profCode = PROFILE_INDEX_MAP[ch.profile] ?? 8;
    buf.writeUInt8(profCode, offset);
    offset += 1;

    let flags = 0;
    if (ch.signalPresent) flags |= 0x01;
    if (ch.agcActive) flags |= 0x02;
    if (ch.isOn) flags |= 0x04;
    buf.writeUInt8(flags, offset);
    offset += 1;

    // Per-mix sends in the exact order of payload.mixes
    for (let i = 0; i < mixCount; i++) {
      const mixId = payload.mixes[i]!.id;
      const send = ch.mixSends[mixId];
      const enabled = send ? send.enabled : false;
      const vol = send ? Math.max(0, Math.min(100, Math.round(send.volumePercent))) : 0;

      // High bit (0x80) = enabled, bits 0..6 (0x7F) = volume 0..100
      let sendByte = vol & 0x7f;
      if (enabled) {
        sendByte |= 0x80;
      }
      buf.writeUInt8(sendByte, offset);
      offset += 1;
    }
  }

  return buf;
}

/**
 * Decodes a binary telemetry packet into a structured TypeScript object.
 * Returns null if packet is invalid or magic mismatch.
 */
export function decodePisoundTelemetryPacket(buf: Buffer): PisoundTelemetryPayload | null {
  if (buf.length < 24) return null;

  let offset = 0;
  const magic = buf.readUInt16BE(offset);
  offset += 2;
  if (magic !== TELEMETRY_MAGIC) return null;

  const version = buf.readUInt8(offset);
  offset += 1;
  if (version !== TELEMETRY_VERSION) return null;

  const type = buf.readUInt8(offset);
  offset += 1;
  if (type !== TELEMETRY_TYPE_SNAPSHOT) return null;

  // Flags (2 bytes)
  offset += 2;

  const sequence = buf.readUInt32BE(offset);
  offset += 4;
  const timestamp = Number(buf.readBigUInt64BE(offset));
  offset += 8;
  const mixCount = buf.readUInt8(offset);
  offset += 1;
  const channelCount = buf.readUInt8(offset);
  offset += 1;
  const activeTalkersMask = buf.readUInt32BE(offset);
  offset += 4;

  const mixes: TelemetryMixSummary[] = [];
  for (let i = 0; i < mixCount; i++) {
    if (offset >= buf.length) return null;
    const idLen = buf.readUInt8(offset);
    offset += 1;
    if (offset + idLen + 3 > buf.length) return null;

    const id = buf.toString('utf8', offset, offset + idLen);
    offset += idLen;

    const controlTypeCode = buf.readUInt8(offset);
    offset += 1;
    const masterVolume = buf.readUInt8(offset);
    offset += 1;
    const masterMuted = buf.readUInt8(offset) !== 0;
    offset += 1;

    mixes.push({
      id,
      controlType: controlTypeCode === 1 ? 'gain' : 'toggle',
      masterVolume,
      masterMuted,
    });
  }

  const channels: TelemetryChannelInput[] = [];
  const channelRecordSize = 1 + 4 + 1 + 1 + mixCount;

  for (let c = 0; c < channelCount; c++) {
    if (offset + channelRecordSize > buf.length) return null;

    const channelIndex = buf.readUInt8(offset);
    offset += 1;
    const peakMilliDbfs = buf.readInt32BE(offset);
    offset += 4;
    const profCode = buf.readUInt8(offset);
    offset += 1;
    const profile = INDEX_PROFILE_MAP[profCode] || 'custom';

    const flags = buf.readUInt8(offset);
    offset += 1;
    const signalPresent = (flags & 0x01) !== 0;
    const agcActive = (flags & 0x02) !== 0;
    const isOn = (flags & 0x04) !== 0;

    const mixSends: Record<string, { enabled: boolean; volumePercent: number }> = {};
    for (let i = 0; i < mixCount; i++) {
      const mixId = mixes[i]!.id;
      const sendByte = buf.readUInt8(offset);
      offset += 1;

      const enabled = (sendByte & 0x80) !== 0;
      const volumePercent = sendByte & 0x7f;
      mixSends[mixId] = { enabled, volumePercent };
    }

    channels.push({
      channelIndex,
      peakMilliDbfs,
      profile,
      signalPresent,
      agcActive,
      isOn,
      mixSends,
    });
  }

  return {
    sequence,
    timestamp,
    activeTalkersMask,
    mixes,
    channels,
  };
}
