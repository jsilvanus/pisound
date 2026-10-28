#!/usr/bin/env node
import net from 'node:net';

/**
 * BSS Soundweb London BLU-100 TCP Simulator
 * Listens on TCP port 1023 (or PORT env var) and validates incoming London DI packets.
 */
const PORT = parseInt(process.env.PORT || '1023', 10);

const STX = 0x02;
const ETX = 0x03;
const ESC = 0x1B;

const MSG_NAMES = {
  0x88: 'SET (Raw)',
  0x89: 'SUBSCRIBE',
  0x8A: 'UNSUBSCRIBE',
  0x8B: 'RECALL DEVICE PRESET',
  0x8C: 'RECALL PARAMETER PRESET',
  0x8D: 'SET PERCENT',
  0x8E: 'SUBSCRIBE PERCENT',
  0x8F: 'UNSUBSCRIBE PERCENT',
  0x91: 'SET STRING'
};

const PRESET_NAMES = {
  0: 'Preset 0: WL to MIXER (Routing to SQ-5 mixing console)',
  1: 'Preset 1: WL NORMAL USE (Sanctuary automixer active)',
  3: 'Preset 3: AUDIO OPEN (Main outputs active)',
  4: 'Preset 4: AUDIO MUTE (Main outputs muted)'
};

const CHANNEL_NAMES = {
  0: 'Kapula 1 (Liturgi / Pappi)',
  1: 'Kapula 2 (Kanttori / Avustaja)',
  2: 'Kapula 3 (Lukija / Vierailija)',
  3: 'Solmio (Saarnaaja / Lavalier)',
  4: 'Mic 1 (Alttari)',
  5: 'Mic 2 (Saarnatuoli)',
  6: 'Mic 3 (Urut / Kuoro)'
};

function unescapeAndVerify(buffer) {
  if (buffer.length < 4 || buffer[0] !== STX || buffer[buffer.length - 1] !== ETX) {
    return null;
  }

  const unescaped = [];
  let i = 1;
  const end = buffer.length - 1;

  while (i < end) {
    const b = buffer[i];
    if (b === ESC) {
      if (i + 1 >= end) return null;
      unescaped.push((buffer[i + 1] - 0x80) & 0xFF);
      i += 2;
    } else {
      unescaped.push(b);
      i++;
    }
  }

  if (unescaped.length === 0) return null;

  const checksum = unescaped[unescaped.length - 1];
  const body = unescaped.slice(0, -1);

  let computed = 0;
  for (const b of body) {
    computed ^= b;
  }

  if (computed !== checksum) {
    return { error: 'Checksum mismatch', computed, checksum };
  }

  return { body: Buffer.from(body) };
}

const server = net.createServer((socket) => {
  const remote = `${socket.remoteAddress}:${socket.remotePort}`;
  console.log(`[BSS BLU-100 SIMULATOR] Client connected from ${remote}`);

  socket.on('data', (data) => {
    const res = unescapeAndVerify(data);
    if (!res) {
      console.warn(`[RAW] Received ${data.length} bytes (not valid London DI framing)`);
      return;
    }
    if (res.error) {
      console.error(`[CHECKSUM ERROR] ${res.error}`);
      return;
    }

    const body = res.body;
    const msgType = body[0];
    const typeName = MSG_NAMES[msgType] || `0x${msgType.toString(16)}`;

    if (msgType === 0x8C) {
      // RECALL PARAMETER PRESET
      const presetId = body.readUInt32BE(1);
      const desc = PRESET_NAMES[presetId] || `Preset #${presetId}`;
      console.log(`\x1b[36m[PRESET RECALL]\x1b[0m -> \x1b[1m${desc}\x1b[0m`);
    } else if (msgType === 0x88) {
      // SET (Mute)
      const nodeId = body.readUInt16BE(1);
      const vd = body[3];
      const objId = body.subarray(4, 7).toString('hex');
      const paramId = body.readUInt16BE(7);
      const val = body.readUInt32BE(9);

      const chName = CHANNEL_NAMES[paramId] || `Channel #${paramId + 1}`;
      const stateStr = val === 0 ? '\x1b[32m[ON / LIVE]\x1b[0m' : '\x1b[31m[MUTED / OFF]\x1b[0m';
      console.log(`\x1b[33m[MIC MUTE TOGGLE]\x1b[0m ${chName} -> ${stateStr}`);
    } else if (msgType === 0x8D) {
      // SET PERCENT (Fader)
      const paramId = body.readUInt16BE(7);
      const scaledVal = body.readUInt32BE(9);
      const percent = ((scaledVal / 65536) * 100).toFixed(1);
      const chIndex = paramId >= 32 ? paramId - 32 : paramId;
      const chName = CHANNEL_NAMES[chIndex] || `Channel #${chIndex + 1}`;
      console.log(`\x1b[35m[FADER ADJUST]\x1b[0m ${chName} -> \x1b[1m${percent}%\x1b[0m`);
    } else {
      console.log(`[MSG] ${typeName} (${body.length} bytes)`);
    }
  });

  socket.on('close', () => {
    console.log(`[BSS BLU-100 SIMULATOR] Client disconnected: ${remote}`);
  });

  socket.on('error', (err) => {
    console.error(`[SOCKET ERROR] ${err.message}`);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(` BSS Soundweb London BLU-100 Protocol Simulator`);
  console.log(` Listening on TCP port ${PORT}`);
  console.log(` Ready to test pisound wireless mic control`);
  console.log(`====================================================`);
});
