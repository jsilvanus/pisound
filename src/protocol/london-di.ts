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

/**
 * Standard Soundweb London Object IDs for Riihimäen Keskuskirkko BLU-100 DSP.
 * Extracted directly from venue design 'Riihimäen kirkko.audioarchitect' (Node 1).
 */
export const BSS_OBJECT_IDS = {
  // Wireless Automixer (12 ch JTS receivers: WL 1 - WL 12) - Obj 333 (0x014D)
  WL_MIXER: Buffer.from([0x00, 0x01, 0x4d]),
  // Sanctuary Fixed Speech Mic Automixer (Saarna, Alttari, Lukupulpetti) - Obj 260 (0x0104)
  MIC_MIXER: Buffer.from([0x00, 0x01, 0x04]),
  // Under-Pulpit Floor Drops (Liitännät saarnatuolin alla 1-8) - Obj 357 (0x0165)
  PATCH_MICS: Buffer.from([0x00, 0x01, 0x65]),
  // Web Radio / Stream output volume & mute - Obj 360 (0x0168)
  RADIO_VOL: Buffer.from([0x00, 0x01, 0x68]),
  // Cantor monitor gain - Obj 358 (0x0166)
  KANTTORI_GAIN: Buffer.from([0x00, 0x01, 0x66]),
  // WL to Mixer router (0 = SQ-5 console via Dante, 1 = Automixer) - Obj 257 (0x0101)
  WL_TO_MIXER_ROUTER: Buffer.from([0x00, 0x01, 0x01]),
  // Wireless master logic mute - Obj 259 (0x0103)
  WL_MASTER_MUTE: Buffer.from([0x00, 0x01, 0x03]),
};

// Default fallback object ID (Wireless Automixer)
export const DEFAULT_OBJECT_ID = BSS_OBJECT_IDS.WL_MIXER;

/**
 * Parameter ID calculation for Harman BSS Automixers (Class 320) & Gain Matrices (Class 258):
 * - Gain parameter for channel k: k * 100 (0, 100, 200, 300, ...)
 * - Mute parameter for channel k: k * 100 + 1 (1, 101, 201, 301, ...)
 */
export function paramIdForChannelGain(channelIndex0Based: number): number {
  return channelIndex0Based * 100;
}

export function paramIdForChannelMute(channelIndex0Based: number): number {
  return channelIndex0Based * 100 + 1;
}

export function channelIndexFromParamId(paramId: number): number {
  return Math.floor(paramId / 100);
}

export function isMuteParamId(paramId: number): boolean {
  return paramId % 100 === 1;
}

export function isGainParamId(paramId: number): boolean {
  return paramId % 100 === 0;
}

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
 * Builds a Set Mute packet for a Soundweb London object.
 * Value: 1 = Muted, 0 = Unmuted.
 */
export function buildSetMutePacket(
  paramId: number,
  isMuted: boolean,
  nodeId: number = DEFAULT_NODE_ID,
  objectId: Buffer = DEFAULT_OBJECT_ID
): Buffer {
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
  paramId: number,
  percent0to100: number,
  nodeId: number = DEFAULT_NODE_ID,
  objectId: Buffer = DEFAULT_OBJECT_ID
): Buffer {
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
  paramId: number,
  rateMs: number = 100,
  nodeId: number = DEFAULT_NODE_ID,
  objectId: Buffer = DEFAULT_OBJECT_ID
): Buffer {
  const body = Buffer.alloc(13);
  body[0] = MSG_SUBSCRIBE_PERCENT;
  body.writeUInt16BE(nodeId, 1);
  body[3] = VD_AUDIO;
  objectId.copy(body, 4, 0, 3);
  body.writeUInt16BE(paramId, 7);
  body.writeUInt32BE(rateMs, 9);
  return encodePacket(body);
}

/**
 * Builds a Subscribe State packet for live mute / button feedback.
 */
export function buildSubscribeStatePacket(
  paramId: number,
  rateMs: number = 100,
  nodeId: number = DEFAULT_NODE_ID,
  objectId: Buffer = DEFAULT_OBJECT_ID
): Buffer {
  const body = Buffer.alloc(13);
  body[0] = MSG_SUBSCRIBE;
  body.writeUInt16BE(nodeId, 1);
  body[3] = VD_AUDIO;
  objectId.copy(body, 4, 0, 3);
  body.writeUInt16BE(paramId, 7);
  body.writeUInt32BE(rateMs, 9);
  return encodePacket(body);
}
