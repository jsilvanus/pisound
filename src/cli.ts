#!/usr/bin/env node
import type {
  AudioMixConfig,
  ChannelMixSend,
  InputProfileDefinition,
  MicChannelState,
  MixMasterState,
  SystemSoundSnapshot,
} from './types.js';

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
    console.log(`-----------------------------------------------------------------------------------------------`);
    for (const m of mics) {
      const stateBadge = m.isOn
        ? '\x1b[42m\x1b[30m PÄÄLLÄ (ON)  \x1b[0m'
        : '\x1b[41m\x1b[37m MYKISTETTY   \x1b[0m';
      const volStr = `${m.volumePercent.toFixed(1)}%`.padStart(6);
      const idStr = m.id.padEnd(10);
      const nameStr = m.name.padEnd(15);
      const profileStr = `[${m.profile}]`.padEnd(10);

      let agcBadge = '\x1b[90mAGC:OFF\x1b[0m';
      if (m.agc.mode === 'agc-pi') agcBadge = `\x1b[36mAGC:PI(${m.agc.targetDbfs}dB)\x1b[0m`;
      else if (m.agc.mode === 'agc-blu') agcBadge = `\x1b[35mAGC:BLU\x1b[0m`;

      const hpfStr = m.eq.hpfEnabled ? `HPF:${m.eq.hpfHz}Hz` : 'HPF:OFF';
      const eqBadge = m.eq.isBypassed ? '\x1b[90mEQ:BYP\x1b[0m' : `\x1b[33mEQ(${hpfStr})\x1b[0m`;

      console.log(`  ${idStr} ${nameStr} ${stateBadge}  Vol:${volStr}  ${profileStr}  ${agcBadge}  ${eqBadge}  (${m.role})`);
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

  if (command === 'profiles') {
    const res = await fetchJson<{ profiles: InputProfileDefinition[] }>('/api/v1/profiles');
    console.log(`\n\x1b[1m=== SAATAVILLA OLEVAT INPUT PROFIILIT ===\x1b[0m\n`);
    for (const p of res.profiles) {
      console.log(`  \x1b[1m\x1b[36m${p.id.padEnd(9)}\x1b[0m  \x1b[32m${p.name.padEnd(25)}\x1b[0m  Fader: ${p.defaultVolume}%  AGC: ${p.defaultAgc.mode}`);
      console.log(`             HPF: ${p.defaultEq.hpfEnabled ? `${p.defaultEq.hpfHz}Hz` : 'OFF'} | Low: ${p.defaultEq.lowDb}dB | Mid: ${p.defaultEq.midHz}Hz (${p.defaultEq.midDb}dB) | High: ${p.defaultEq.highDb}dB`);
      console.log(`             ${p.description}\n`);
    }
    return;
  }

  if (command === 'mix' || command === 'mixes') {
    const mixId = args[1];

    if (!mixId || mixId === 'list' || mixId === 'ls') {
      const res = await fetchJson<{ mixes: AudioMixConfig[]; masterStates: MixMasterState[] }>('/api/v1/mixes');
      console.log(`\n\x1b[1m=== AUDIO MIKSAUKSET (CONFIGURED MIXES) ===\x1b[0m\n`);
      for (const m of res.mixes) {
        const master = res.masterStates.find((s) => s.id === m.id);
        const modeBadge =
          m.controlType === 'toggle'
            ? '\x1b[33m[ON/OFF TOGGLE ONLY - NO GAIN]\x1b[0m'
            : '\x1b[36m[FULL FADER GAIN + MUTE]\x1b[0m';
        const muteBadge = master?.isMuted ? '\x1b[41m\x1b[37m MUTED \x1b[0m' : '\x1b[42m\x1b[30m ACTIVE \x1b[0m';
        console.log(`  \x1b[1m\x1b[32m${m.id.padEnd(10)}\x1b[0m  ${m.name.padEnd(28)}  ${modeBadge}`);
        console.log(`              Master Vol: \x1b[1m${master?.volumePercent ?? m.defaultMasterVolume}%\x1b[0m | Master Status: ${muteBadge}\n`);
      }
      return;
    }

    const sub = args[2];

    // Master volume or mute
    if (sub === 'master') {
      const volNum = parseFloat(args[3] || '');
      if (isNaN(volNum) || volNum < 0 || volNum > 100) {
        console.error(`Invalid master volume: ${args[3]}. Must be 0..100.`);
        process.exit(1);
      }
      const res = await fetchJson<{ ok: boolean; master: MixMasterState }>(`/api/v1/mixes/${mixId}/master/volume`, {
        method: 'POST',
        body: JSON.stringify({ volumePercent: volNum }),
      });
      console.log(`\x1b[32m[OK]\x1b[0m Mix '${mixId}' master volume set to ${res.master.volumePercent}%`);
      return;
    }

    if (sub === 'mute') {
      const res = await fetchJson<{ ok: boolean; master: MixMasterState }>(`/api/v1/mixes/${mixId}/master/mute`, {
        method: 'POST',
        body: JSON.stringify({ muted: true }),
      });
      console.log(`\x1b[31m[MUTED]\x1b[0m Mix '${mixId}' master is now MUTED`);
      return;
    }

    if (sub === 'unmute') {
      const res = await fetchJson<{ ok: boolean; master: MixMasterState }>(`/api/v1/mixes/${mixId}/master/mute`, {
        method: 'POST',
        body: JSON.stringify({ muted: false }),
      });
      console.log(`\x1b[32m[OPEN]\x1b[0m Mix '${mixId}' master is now UNMUTED`);
      return;
    }

    // Inspect single mix table
    if (!sub || sub === 'status') {
      const res = await fetchJson<{
        config: AudioMixConfig;
        master: MixMasterState;
        channels: Array<{
          id: string;
          name: string;
          role: string;
          send: ChannelMixSend;
          peakDbfs: number;
        }>;
      }>(`/api/v1/mixes/${mixId}`);

      const typeLabel =
        res.config.controlType === 'toggle'
          ? '\x1b[33mON/OFF ROUTING (NO GAIN FADERS)\x1b[0m'
          : '\x1b[36mPER-CHANNEL GAIN FADERS\x1b[0m';

      console.log(`\n\x1b[1m=== MIX: ${res.config.name} (${res.config.id}) ===\x1b[0m`);
      console.log(`Mode: ${typeLabel} | Master: ${res.master.volumePercent}% (${res.master.isMuted ? 'MUTED' : 'UNMUTED'})\n`);
      console.log(`-----------------------------------------------------------------------------------------------`);

      for (const ch of res.channels) {
        const idStr = ch.id.padEnd(10);
        const nameStr = ch.name.padEnd(15);
        const stateBadge = ch.send.enabled
          ? '\x1b[42m\x1b[30m ROUTED (ON) \x1b[0m'
          : '\x1b[41m\x1b[37m MUTED (OFF) \x1b[0m';
        const gainStr =
          res.config.controlType === 'gain'
            ? `Gain: \x1b[1m${ch.send.volumePercent.toFixed(1)}%\x1b[0m`.padEnd(16)
            : '\x1b[90m(Gain N/A)\x1b[0m'.padEnd(16);

        console.log(`  ${idStr} ${nameStr}  ${stateBadge}  ${gainStr}  (${ch.role})`);
      }
      console.log();
      return;
    }

    // Subcommand is a channel ID: pisound mix <mixId> <channelId> <on|off|toggle|vol <val>>
    const channelId = sub;
    const action = args[3];

    if (!action || action === 'toggle') {
      const res = await fetchJson<{ ok: boolean; send: ChannelMixSend }>(
        `/api/v1/mixes/${mixId}/channels/${channelId}/toggle`,
        { method: 'POST' }
      );
      const st = res.send.enabled ? '\x1b[32mROUTED (ON)\x1b[0m' : '\x1b[31mMUTED (OFF)\x1b[0m';
      console.log(`\x1b[32m[OK]\x1b[0m ${channelId} in mix '${mixId}' toggled -> ${st}`);
      return;
    }

    if (action === 'on') {
      const res = await fetchJson<{ ok: boolean; send: ChannelMixSend }>(
        `/api/v1/mixes/${mixId}/channels/${channelId}`,
        {
          method: 'POST',
          body: JSON.stringify({ enabled: true }),
        }
      );
      console.log(`\x1b[32m[OK]\x1b[0m ${channelId} is now \x1b[32m\x1b[1mROUTED (ON)\x1b[0m in mix '${mixId}'`);
      return;
    }

    if (action === 'off') {
      const res = await fetchJson<{ ok: boolean; send: ChannelMixSend }>(
        `/api/v1/mixes/${mixId}/channels/${channelId}`,
        {
          method: 'POST',
          body: JSON.stringify({ enabled: false }),
        }
      );
      console.log(`\x1b[33m[OK]\x1b[0m ${channelId} is now \x1b[31m\x1b[1mMUTED (OFF)\x1b[0m in mix '${mixId}'`);
      return;
    }

    if (action === 'vol' || action === 'volume') {
      const volNum = parseFloat(args[4] || '');
      if (isNaN(volNum) || volNum < 0 || volNum > 100) {
        console.error(`Invalid volume percentage: ${args[4]}. Must be 0..100.`);
        process.exit(1);
      }
      const res = await fetchJson<{ ok: boolean; send: ChannelMixSend }>(
        `/api/v1/mixes/${mixId}/channels/${channelId}`,
        {
          method: 'POST',
          body: JSON.stringify({ volumePercent: volNum }),
        }
      );
      console.log(`\x1b[32m[OK]\x1b[0m ${channelId} gain set to ${res.send.volumePercent}% in mix '${mixId}'`);
      return;
    }

    console.error(`Usage: pisound mix <mixId> <channelId> [on|off|toggle|vol <0-100>]`);
    process.exit(1);
  }

  if (command === 'mic') {
    const micId = args[1];
    const action = args[2];

    if (!micId) {
      console.error(`Usage: pisound mic <mic-id> [on|off|toggle|solo|vol <0-100>|profile <name>|agc <none|pi|blu>|eq]`);
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
      const volNum = parseFloat(args[3] || '');
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

    if (action === 'profile') {
      const profileName = args[3];
      if (!profileName) {
        console.error(`Usage: pisound mic <id> profile <speech|vocal|guitar|piano|choir|organ|drums|ambient|custom>`);
        process.exit(1);
      }
      const res = await fetchJson<{ ok: boolean; channel: MicChannelState }>(`/api/v1/mics/${micId}/profile`, {
        method: 'POST',
        body: JSON.stringify({ profile: profileName }),
      });
      console.log(`\x1b[32m[OK]\x1b[0m ${res.channel.name} profile set to \x1b[1m\x1b[36m${res.channel.profile}\x1b[0m (Fader: ${res.channel.volumePercent}%, AGC: ${res.channel.agc.mode}, HPF: ${res.channel.eq.hpfHz}Hz)`);
      return;
    }

    if (action === 'agc') {
      const modeStr = args[3];
      if (!['none', 'pi', 'blu', 'agc-pi', 'agc-blu'].includes(modeStr || '')) {
        console.error(`Usage: pisound mic <id> agc <none|pi|blu>`);
        process.exit(1);
      }
      const mappedMode = modeStr === 'pi' ? 'agc-pi' : modeStr === 'blu' ? 'agc-blu' : modeStr;
      const res = await fetchJson<{ ok: boolean; id: string; agc: { mode: string } }>(`/api/v1/mics/${micId}/agc`, {
        method: 'POST',
        body: JSON.stringify({ mode: mappedMode }),
      });
      console.log(`\x1b[32m[OK]\x1b[0m ${micId} AGC mode set to \x1b[1m${res.agc.mode}\x1b[0m`);
      return;
    }

    if (action === 'eq') {
      const chEq = await fetchJson<{ id: string; eq: Record<string, unknown> }>(`/api/v1/mics/${micId}/eq`);
      console.log(`EQ for ${micId}:`, chEq.eq);
      return;
    }

    console.error(`Unknown mic action: ${action}. Valid: on, off, toggle, solo, vol, profile, agc, eq`);
    process.exit(1);
  }

  if (command === 'wireless') {
    const sub = args[1];
    if (sub === 'mute-all' || sub === 'off') {
      await fetchJson('/api/v1/groups/wireless/mute-all', { method: 'POST' });
      console.log(`\x1b[31m\x1b[1m[ALL WIRELESS MUTED]\x1b[0m All 14 wireless mics are now MUTED.`);
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
  pisound status                           Show full status table of all mics, profiles & AGC
  pisound profiles                         List all available input profiles with EQ & AGC settings
  pisound mix list                         List all configured mixes (Sali, Striimi, Web Radio, etc.)
  pisound mix <mixId>                      Show channel status in a mix (e.g. 'pisound mix sali')
  pisound mix <mixId> <micId> on|off       Route or mute a mic in a specific mix
  pisound mix <mixId> <micId> vol <0-100>  Set mic gain in a gain mix (striimi, webradio)
  pisound mix <mixId> master <0-100>       Set master volume of a mix
  pisound mix <mixId> mute|unmute          Mute or unmute master of a mix
  pisound mic <id> on                      Turn on (unmute) a specific microphone
  pisound mic <id> off                     Mute a specific microphone
  pisound mic <id> toggle                  Toggle mic between on and off
  pisound mic <id> solo                    Solo mic (turns this on, mutes all other wireless)
  pisound mic <id> vol <0-100>             Set mic gain/volume percentage
  pisound mic <id> profile <name>          Assign profile (speech, vocal, guitar, piano, choir, organ, drums)
  pisound mic <id> agc <none|pi|blu>       Set AGC auto-leveler mode
  pisound wireless mute-all                Instantly mute all wireless mics
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
