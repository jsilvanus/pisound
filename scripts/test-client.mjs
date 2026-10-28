#!/usr/bin/env node
import net from 'node:net';

const PORT = parseInt(process.env.PORT || '1023', 10);
const HOST = process.env.HOST || '127.0.0.1';

const STX = 0x02;
const ETX = 0x03;
const ESC = 0x1B;
const SPECIAL = [0x02, 0x03, 0x06, 0x15, 0x1B];

function encodePacket(body) {
  let checksum = 0;
  for (const b of body) {
    checksum ^= b;
  }

  const out = [STX];
  for (const b of body) {
    if (SPECIAL.includes(b)) {
      out.push(ESC, (b + 0x80) & 0xFF);
    } else {
      out.push(b);
    }
  }

  if (SPECIAL.includes(checksum)) {
    out.push(ESC, (checksum + 0x80) & 0xFF);
  } else {
    out.push(checksum);
  }

  out.push(ETX);
  return Buffer.from(out);
}

function buildRecallPreset(presetId) {
  const buf = Buffer.alloc(5);
  buf[0] = 0x8C;
  buf.writeUInt32BE(presetId, 1);
  return encodePacket(buf);
}

function buildSetMute(channel0Based, isMuted) {
  const buf = Buffer.alloc(13);
  buf[0] = 0x88; // SET
  buf.writeUInt16BE(0x0001, 1); // Node ID
  buf[3] = 0x03; // Audio VD
  Buffer.from([0x00, 0x01, 0x07]).copy(buf, 4); // Object ID (MR_MIC_MIXER)
  buf.writeUInt16BE(channel0Based, 7); // Param ID = channel
  buf.writeUInt32BE(isMuted ? 1 : 0, 9); // 1 = Muted, 0 = Unmuted
  return encodePacket(buf);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  console.log(`Connecting to BSS Soundweb at ${HOST}:${PORT}...`);
  const client = net.createConnection({ host: HOST, port: PORT });

  client.on('connect', async () => {
    console.log(`Connected! Running wireless microphone test sequence...\n`);

    // 1. Recall WL Normal Use
    console.log(`Step 1: Recalling Preset 1 (WL Normal Use / Automixer)`);
    client.write(buildRecallPreset(1));
    await sleep(600);

    // 2. Turn ON Kapula 1 (Liturgi)
    console.log(`Step 2: Turning ON Kapula 1`);
    client.write(buildSetMute(0, false));
    await sleep(600);

    // 3. Turn ON Solmio (Saarnaaja) and MUTE Kapula 1 (Solo Solmio for sermon)
    console.log(`Step 3: Priest walks to pulpit -> Solo Solmio (Kapula 1 muted, Solmio ON)`);
    client.write(buildSetMute(0, true));
    client.write(buildSetMute(3, false));
    await sleep(600);

    // 4. Mute all wireless mics (e.g. choir singing)
    console.log(`Step 4: Choir piece -> Muting all wireless mics`);
    client.write(buildSetMute(0, true));
    client.write(buildSetMute(1, true));
    client.write(buildSetMute(2, true));
    client.write(buildSetMute(3, true));
    await sleep(600);

    console.log(`\nTest sequence finished successfully!`);
    client.end();
  });

  client.on('error', (err) => {
    console.error(`Connection failed: ${err.message}`);
  });
}

run();
