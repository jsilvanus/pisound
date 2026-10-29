#!/usr/bin/env node
import { parseArgs } from 'node:util';
import type { MicChannelState, SystemSoundSnapshot } from './types.js';

const API_BASE = process.env.PISOUND_API_URL || 'http://127.0.0.1:3300';

async function fetchJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE}${path}`;
  const headers: Record<string, string> = { ...(options.headers as Record<string, string>) };
  if (options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  try {
    const res = await fetch(url, {
      ...options,
      headers,
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`HTTP ${res.status}: ${body}`);
    }
    return (await res.json()) as T;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\x1b[31mError connecting to pisound daemon at ${url}:\x1b[0m ${message}`);
    console.error(`Is the pisound service running? (npm start)`);
    process.exit(1);
  }
}

function printStatusTable(snapshot: SystemSoundSnapshot): void {
  console.log(`\n\x1b[1m=== PISOUND SOUND SYSTEM STATUS ===\x1b[0m`);
  console.log(`Daemon: \x1b[36m${API_BASE}\x1b[0m | Soundweb DSP: \x1b[33m${snapshot.host}:${snapshot.port}\x1b[0m (${snapshot.status.toUpperCase()})`);
  console.log(`Active Preset: \x1b[32m\x1b[1m${snapshot.currentPreset.name}\x1b[0m (${snapshot.currentPreset.description})`);
  console.log(`Active Wireless: \x1b[1m${snapshot.activeWirelessCount}\x1b[0m | Active Wired: \x1b[1m${snapshot.activeWiredCount}\x1b[0m\n`);

  const printGroup = (title: string, mics: MicChannelState[]) => {
    console.log(`\x1b[1m${title}\x1b[0m`);
    console.log(`--------------------------------------------------------------------------------`);
    for (const m of mics) {
      const stateBadge = m.isOn
        ? '\x1b[42m\x1b[30m PÄÄLLÄ (ON)  \x1b[0m'
        : '\x1b[41m\x1b[37m MYKISTETTY   \x1b[0m';
      const volStr = `${m.volumePercent}%`.padStart(4);
      const idStr = m.id.padEnd(11);
      const nameStr = m.name.padEnd(16);
      const roleStr = m.role;
      console.log(`  ${idStr} ${nameStr} ${stateBadge}  Vol: ${volStr}  (${roleStr})`);
    }
    console.log();
  };

  const handhelds = snapshot.channels.filter((c) => c.group === 'handheld');
  const madonnas = snapshot.channels.filter((c) => c.group === 'madonna');
  const wired = snapshot.channels.filter((c) => c.group === 'wired');

  printGroup('LANGATTOMAT KAPULAMIKROFONIT (1-4):', handhelds);
  printGroup('LANGATTOMAT MADONNAMIKROFONIT (5-14):', madonnas);
  printGroup('KIINTEÄT MIKROFONIT (1-12+):', wired);
}

export async function runCli(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] || 'status';

  if (command === 'status' || command === 'ls' || command === 'list') {
    const snapshot = await fetchJson<SystemSoundSnapshot>('/api/v1/status');
    printStatusTable(snapshot);
    return;
  }

  if (command === 'mic') {
    const micId = args[1];
    const action = args[2];

    if (!micId) {
      console.error(`Usage: pisound mic <mic-id> [on|off|toggle|solo|vol <0-100>]`);
      process.exit(1);
    }

    if (!action || action === 'status') {
      const ch = await fetchJson<MicChannelState>(`/api/v1/mics/${micId}`);
      console.log(ch);
      return;
    }

    if (action === 'on') {
      const res = await fetchJson<{ ok: boolean; channel: MicChannelState }>(`/api/v1/mics/${micId}/state`, {
        method: 'POST',
        body: JSON.stringify({ on: true }),
      });
      console.log(`\x1b[32m[OK]\x1b[0m ${res.channel.name} (${res.channel.id}) is now \x1b[32m\x1b[1mON (Live)\x1b[0m`);
      return;
    }

    if (action === 'off') {
      const res = await fetchJson<{ ok: boolean; channel: MicChannelState }>(`/api/v1/mics/${micId}/state`, {
        method: 'POST',
        body: JSON.stringify({ on: false }),
      });
      console.log(`\x1b[33m[OK]\x1b[0m ${res.channel.name} (${res.channel.id}) is now \x1b[31m\x1b[1mMUTED (Off)\x1b[0m`);
      return;
    }

    if (action === 'toggle') {
      const res = await fetchJson<{ ok: boolean; channel: MicChannelState }>(`/api/v1/mics/${micId}/toggle`, {
        method: 'POST',
      });
      const st = res.channel.isOn ? '\x1b[32mON (Live)\x1b[0m' : '\x1b[31mMUTED (Off)\x1b[0m';
      console.log(`\x1b[32m[OK]\x1b[0m ${res.channel.name} toggled -> ${st}`);
      return;
    }

    if (action === 'solo') {
      const res = await fetchJson<{ ok: boolean; solo: string; channel: MicChannelState }>(`/api/v1/mics/${micId}/solo`, {
        method: 'POST',
      });
      console.log(`\x1b[35m\x1b[1m[SOLO ACTIVE]\x1b[0m ${res.channel.name} (${res.channel.id}) is ON. All other wireless mics MUTED.`);
      return;
    }

    if (action === 'vol' || action === 'volume') {
      const volNum = parseInt(args[3] || '', 10);
      if (isNaN(volNum) || volNum < 0 || volNum > 100) {
        console.error(`Invalid volume percentage: ${args[3]}. Must be 0..100.`);
        process.exit(1);
      }
      const res = await fetchJson<{ ok: boolean; channel: MicChannelState }>(`/api/v1/mics/${micId}/volume`, {
        method: 'POST',
        body: JSON.stringify({ volumePercent: volNum }),
      });
      console.log(`\x1b[32m[OK]\x1b[0m ${res.channel.name} volume set to ${res.channel.volumePercent}%`);
      return;
    }

    console.error(`Unknown mic action: ${action}. Valid: on, off, toggle, solo, vol`);
    process.exit(1);
  }

  if (command === 'wireless') {
    const sub = args[1];
    if (sub === 'mute-all' || sub === 'off') {
      await fetchJson('/api/v1/groups/wireless/mute-all', { method: 'POST' });
      console.log(`\x1b[31m\x1b[1m[ALL WIRELESS MUTED]\x1b[0m All 14 wireless mics (Kapulat 1-4 & Madonnat 1-10) are now MUTED.`);
      return;
    }
    if (sub === 'all-on' || sub === 'on') {
      await fetchJson('/api/v1/groups/wireless/unmute-all', { method: 'POST' });
      console.log(`\x1b[32m\x1b[1m[ALL WIRELESS OPEN]\x1b[0m All 14 wireless mics are now OPEN.`);
      return;
    }
    console.error(`Usage: pisound wireless [mute-all | all-on]`);
    process.exit(1);
  }

  if (command === 'preset') {
    const target = args[1];
    if (!target) {
      console.error(`Usage: pisound preset <normal | mixer | open | mute | <number>>`);
      process.exit(1);
    }
    const res = await fetchJson<{ ok: boolean; preset: { name: string; id: number } }>(`/api/v1/presets/${target}`, {
      method: 'POST',
    });
    console.log(`\x1b[32m[OK]\x1b[0m Recalled preset: \x1b[1m${res.preset.name}\x1b[0m (ID #${res.preset.id})`);
    return;
  }

  console.log(`pisound - Sound & Mic Controller CLI

Usage:
  pisound status                           Show full status table of all mics & presets
  pisound mic <id> on                      Turn on (unmute) a specific microphone
  pisound mic <id> off                     Mute a specific microphone
  pisound mic <id> toggle                  Toggle mic between on and off
  pisound mic <id> solo                    Solo mic (turns this on, mutes all other wireless)
  pisound mic <id> vol <0-100>             Set mic gain/volume percentage
  pisound wireless mute-all                Instantly mute all wireless mics (Kapulat & Madonnat)
  pisound wireless all-on                  Unmute all wireless mics
  pisound preset <normal|mixer|open|mute>  Recall an audio routing preset
`);
}

// Run CLI if invoked directly
const isMain = process.argv[1]?.endsWith('cli.ts') || process.argv[1]?.endsWith('cli.js') || process.argv[1]?.endsWith('pisound.mjs');
if (isMain) {
  runCli().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
