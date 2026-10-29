/**
 * London Direct Inject (London DI) protocol encoding and decoding for Harman / BSS Soundweb London.
 */

export const STX = 0x02;
export const ETX = 0x03;
export const ACK = 0x06;
export const NAK = 0x15;
export const ESC = 0x1B;

export const SPECIAL_BYTES = new Set([STX, ETX, ACK, NAK, ESC]);

export const MSG_SET = 0x88;
export const MSG_SUBSCRIBE = 0x89;
export const MSG_UNSUBSCRIBE = 0x8A;
export const MSG_RECALL_DEVICE_PRESET = 0x8B;
export const MSG_RECALL_PARAM_PRESET = 0x8C;
export const MSG_SET_PERCENT = 0x8D;
export const MSG_SUBSCRIBE_PERCENT = 0x8E;
export const MSG_UNSUBSCRIBE_PERCENT = 0x8F;
export const MSG_SET_STRING = 0x91;

export const VD_LOGIC = 0x02;
export const VD_AUDIO = 0x03;

export const DEFAULT_NODE_ID = 0x0001;
// MR_MIC_MIXER object ID (3 bytes: 0x00, 0x01, 0x07) from NetLinx source
export const DEFAULT_OBJECT_ID = Buffer.from([0x00, 0x01, 0x07]);

/**
 * Escapes a raw buffer and appends the XOR checksum, wrapped in STX and ETX.
 */
export function encodePacket(body: Buffer): Buffer {
  let checksum = 0;
  for (const b of body) {
    checksum ^= b;
  }

  const out: number[] = [STX];

  for (const b of body) {
    if (SPECIAL_BYTES.has(b)) {
      out.push(ESC, (b + 0x80) & 0xff);
    } else {
      out.push(b);
    }
  }

  // Checksum escaping
  if (SPECIAL_BYTES.has(checksum)) {
    out.push(ESC, (checksum + 0x80) & 0xff);
  } else {
    out.push(checksum);
  }

  out.push(ETX);
  return Buffer.from(out);
}

/**
 * Validates and unescapes an STX...ETX packet, checking the XOR checksum.
 * Returns the unescaped body, or null if invalid.
 */
export function decodePacket(packet: Buffer): Buffer | null {
  if (packet.length < 4 || packet[0] !== STX || packet[packet.length - 1] !== ETX) {
    return null;
  }

  const unescaped: number[] = [];
  let i = 1;
  const end = packet.length - 1;

  while (i < end) {
    const b = packet[i]!;
    if (b === ESC) {
      if (i + 1 >= end) return null; // Malformed trailing escape
      const next = packet[i + 1]!;
      unescaped.push((next - 0x80) & 0xff);
      i += 2;
    } else {
      unescaped.push(b);
      i++;
    }
  }

  if (unescaped.length === 0) return null;

  const receivedChecksum = unescaped[unescaped.length - 1]!;
  const body = Buffer.from(unescaped.slice(0, -1));

  let computedChecksum = 0;
  for (const b of body) {
    computedChecksum ^= b;
  }

  if (computedChecksum !== receivedChecksum) {
    return null; // Checksum mismatch
  }

  return body;
}

/**
 * Builds a Recall Parameter Preset packet (e.g. 0 = WL to Mixer, 1 = WL Normal Use).
 */
export function buildRecallPresetPacket(presetId: number): Buffer {
  const body = Buffer.alloc(5);
  body[0] = MSG_RECALL_PARAM_PRESET;
  body.writeUInt32BE(presetId, 1);
  return encodePacket(body);
}

/**
 * Builds a Set Mute packet for a Mixer channel.
 * In BSS Mixer objects, mute for channel N (0-indexed) is parameter ID N.
 * Value: 1 = Muted, 0 = Unmuted.
 */
export function buildSetMutePacket(
  channelIndex0Based: number,
  isMuted: boolean,
  nodeId: number = DEFAULT_NODE_ID,
  objectId: Buffer = DEFAULT_OBJECT_ID
): Buffer {
  const paramId = channelIndex0Based;
  const body = Buffer.alloc(13);
  body[0] = MSG_SET;
  body.writeUInt16BE(nodeId, 1);
  body[3] = VD_AUDIO;
  objectId.copy(body, 4, 0, 3);
  body.writeUInt16BE(paramId, 7);
  body.writeUInt32BE(isMuted ? 1 : 0, 9);
  return encodePacket(body);
}

/**
 * Builds a Set Gain Percent packet (0-100%).
 * Soundweb London uses 16-bit integer 0..65536 for percentage.
 */
export function buildSetGainPercentPacket(
  channelIndex0Based: number,
  percent0to100: number,
  nodeId: number = DEFAULT_NODE_ID,
  objectId: Buffer = DEFAULT_OBJECT_ID
): Buffer {
  const paramId = 32 + channelIndex0Based; // Gain parameter offset
  const clamped = Math.max(0, Math.min(100, percent0to100));
  const scaled = Math.round((clamped / 100) * 65536);

  const body = Buffer.alloc(13);
  body[0] = MSG_SET_PERCENT;
  body.writeUInt16BE(nodeId, 1);
  body[3] = VD_AUDIO;
  objectId.copy(body, 4, 0, 3);
  body.writeUInt16BE(paramId, 7);
  body.writeUInt32BE(scaled, 9);
  return encodePacket(body);
}

/**
 * Builds a Subscribe Percent packet for live volume feedback.
 */
export function buildSubscribePercentPacket(
  channelIndex0Based: number,
  rateMs: number = 100,
  nodeId: number = DEFAULT_NODE_ID,
  objectId: Buffer = DEFAULT_OBJECT_ID
): Buffer {
  const paramId = 32 + channelIndex0Based;
  const body = Buffer.alloc(13);
  body[0] = MSG_SUBSCRIBE_PERCENT;
  body.writeUInt16BE(nodeId, 1);
  body[3] = VD_AUDIO;
  objectId.copy(body, 4, 0, 3);
  body.writeUInt16BE(paramId, 7);
  body.writeUInt32BE(rateMs, 9);
  return encodePacket(body);
}
