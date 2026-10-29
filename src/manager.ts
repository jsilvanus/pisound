import { EventEmitter } from 'node:events';
import { DEFAULT_CHANNELS } from './channels.js';
import {
  KNOWN_PRESETS,
  type MicChannelConfig,
  type MicChannelState,
  type MicGroup,
  type RoutingPreset,
  type RoutingPresetKey,
  type SoundwebConnectionStatus,
  type SystemSoundSnapshot,
} from './types.js';
import {
  buildRecallPresetPacket,
  buildSetGainPercentPacket,
  buildSetMutePacket,
} from './protocol/london-di.js';
import { SoundwebClient } from './soundweb/client.js';
import { SoundwebSimulator } from './soundweb/simulator.js';

export interface SoundManagerOptions {
  mode?: 'production' | 'simulation';
  host?: string;
  port?: number;
  channels?: MicChannelConfig[];
  initialPreset?: RoutingPresetKey;
}

export class SoundManager extends EventEmitter {
  public readonly mode: 'production' | 'simulation';
  private channels = new Map<string, MicChannelState>();
  private channelIndexMap = new Map<number, MicChannelState>();
  private currentPreset: RoutingPreset;
  private soundweb: SoundwebClient | SoundwebSimulator;

  constructor(options: SoundManagerOptions = {}) {
    super();
    this.mode = options.mode || (process.env.PISOUND_MODE === 'production' ? 'production' : 'simulation');
    this.currentPreset = KNOWN_PRESETS[options.initialPreset || 'normal'];

    const channelConfigs = options.channels || DEFAULT_CHANNELS;
    const now = new Date().toISOString();

    for (const cfg of channelConfigs) {
      // By default: Handheld 1 is ON, all other wireless mics are MUTED (safe default).
      // Wired altar & lectern are ON by default.
      const isDefaultOn =
        cfg.id === 'kapula1' || cfg.id === 'wired1' || cfg.id === 'wired3';

      const state: MicChannelState = {
        ...cfg,
        isOn: isDefaultOn,
        volumePercent: cfg.defaultVolume,
        signalPresent: false,
        lastChangedAt: now,
      };

      this.channels.set(cfg.id, state);
      this.channelIndexMap.set(cfg.channelIndex, state);
    }

    if (this.mode === 'production') {
      const host = options.host || process.env.PISOUND_SOUNDWEB_HOST || '192.168.1.30';
      const port = options.port || parseInt(process.env.PISOUND_SOUNDWEB_PORT || '1023', 10);
      this.soundweb = new SoundwebClient({ host, port });
    } else {
      this.soundweb = new SoundwebSimulator();
    }

    this.setupSoundwebListeners();
  }

  public getSnapshot(): SystemSoundSnapshot {
    const channelList = Array.from(this.channels.values());
    const activeWireless = channelList.filter((c) => c.isWireless && c.isOn).length;
    const activeWired = channelList.filter((c) => !c.isWireless && c.isOn).length;

    let host = 'simulated';
    let port = 1023;
    if (this.soundweb instanceof SoundwebClient) {
      host = this.soundweb.host;
      port = this.soundweb.port;
    }

    return {
      service: 'pisound',
      status: this.soundweb.getStatus(),
      host,
      port,
      mode: this.mode,
      currentPreset: this.currentPreset,
      activeWirelessCount: activeWireless,
      activeWiredCount: activeWired,
      channels: channelList,
      timestamp: new Date().toISOString(),
    };
  }

  public getChannel(id: string): MicChannelState | undefined {
    return this.channels.get(id);
  }

  public getAllChannels(): MicChannelState[] {
    return Array.from(this.channels.values());
  }

  public setMicState(id: string, isOn: boolean): MicChannelState {
    const channel = this.channels.get(id);
    if (!channel) {
      throw new Error(`Microphone channel not found: ${id}`);
    }

    channel.isOn = isOn;
    channel.lastChangedAt = new Date().toISOString();

    const isMuted = !isOn;
    const packet = buildSetMutePacket(channel.channelIndex, isMuted);
    this.soundweb.send(packet);

    this.emit('mic_change', channel);
    return channel;
  }

  public toggleMic(id: string): MicChannelState {
    const channel = this.channels.get(id);
    if (!channel) {
      throw new Error(`Microphone channel not found: ${id}`);
    }
    return this.setMicState(id, !channel.isOn);
  }

  /**
   * Solo: Turns ON the specified microphone, and immediately MUTES all other microphones in the same category
   * (or all other wireless mics if it is a wireless mic).
   */
  public soloMic(id: string): MicChannelState {
    const target = this.channels.get(id);
    if (!target) {
      throw new Error(`Microphone channel not found: ${id}`);
    }

    const isTargetWireless = target.isWireless;
    const now = new Date().toISOString();

    for (const ch of this.channels.values()) {
      const shouldMute = isTargetWireless ? ch.isWireless && ch.id !== id : ch.group === target.group && ch.id !== id;
      if (shouldMute && ch.isOn) {
        ch.isOn = false;
        ch.lastChangedAt = now;
        const packet = buildSetMutePacket(ch.channelIndex, true);
        this.soundweb.send(packet);
        this.emit('mic_change', ch);
      }
    }

    // Turn target ON
    target.isOn = true;
    target.lastChangedAt = now;
    const packet = buildSetMutePacket(target.channelIndex, false);
    this.soundweb.send(packet);
    this.emit('mic_change', target);

    return target;
  }

  public setMicVolume(id: string, volumePercent: number): MicChannelState {
    const channel = this.channels.get(id);
    if (!channel) {
      throw new Error(`Microphone channel not found: ${id}`);
    }

    const clamped = Math.max(0, Math.min(100, volumePercent));
    channel.volumePercent = clamped;
    channel.lastChangedAt = new Date().toISOString();

    const packet = buildSetGainPercentPacket(channel.channelIndex, clamped);
    this.soundweb.send(packet);

    this.emit('mic_change', channel);
    return channel;
  }

  public muteGroup(group: MicGroup | 'wireless' | 'all'): void {
    const now = new Date().toISOString();
    for (const ch of this.channels.values()) {
      let matches = false;
      if (group === 'all') matches = true;
      else if (group === 'wireless') matches = ch.isWireless;
      else matches = ch.group === group;

      if (matches && ch.isOn) {
        ch.isOn = false;
        ch.lastChangedAt = now;
        this.soundweb.send(buildSetMutePacket(ch.channelIndex, true));
        this.emit('mic_change', ch);
      }
    }
    this.emit('bulk_change', { group, action: 'mute' });
  }

  public unmuteGroup(group: MicGroup | 'wireless' | 'all'): void {
    const now = new Date().toISOString();
    for (const ch of this.channels.values()) {
      let matches = false;
      if (group === 'all') matches = true;
      else if (group === 'wireless') matches = ch.isWireless;
      else matches = ch.group === group;

      if (matches && !ch.isOn) {
        ch.isOn = true;
        ch.lastChangedAt = now;
        this.soundweb.send(buildSetMutePacket(ch.channelIndex, false));
        this.emit('mic_change', ch);
      }
    }
    this.emit('bulk_change', { group, action: 'unmute' });
  }

  public recallPreset(presetKeyOrId: RoutingPresetKey | number): RoutingPreset {
    let preset: RoutingPreset | undefined;

    if (typeof presetKeyOrId === 'number') {
      preset = Object.values(KNOWN_PRESETS).find((p) => p.id === presetKeyOrId);
      if (!preset) {
        preset = {
          id: presetKeyOrId,
          key: 'normal',
          name: `Preset #${presetKeyOrId}`,
          description: `Custom Soundweb London parameter preset #${presetKeyOrId}`,
        };
      }
    } else {
      preset = KNOWN_PRESETS[presetKeyOrId];
    }

    if (!preset) {
      throw new Error(`Unknown preset: ${presetKeyOrId}`);
    }

    this.currentPreset = preset;
    const packet = buildRecallPresetPacket(preset.id);
    this.soundweb.send(packet);
    this.emit('preset_change', preset);

    return preset;
  }

  public close(): void {
    this.soundweb.destroy();
    this.removeAllListeners();
  }

  private setupSoundwebListeners(): void {
    this.soundweb.on('status_change', (status: SoundwebConnectionStatus) => {
      this.emit('connection_change', status);
    });

    if (this.soundweb instanceof SoundwebSimulator) {
      this.soundweb.on('sim_mute', ({ channelIndex, isMuted }) => {
        const ch = this.channelIndexMap.get(channelIndex);
        if (ch) {
          ch.isOn = !isMuted;
          ch.lastChangedAt = new Date().toISOString();
        }
      });
      this.soundweb.on('sim_volume', ({ channelIndex, volumePercent }) => {
        const ch = this.channelIndexMap.get(channelIndex);
        if (ch) {
          ch.volumePercent = volumePercent;
          ch.lastChangedAt = new Date().toISOString();
        }
      });
    }
  }
}
