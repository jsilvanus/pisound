import { EventEmitter } from 'node:events';
import { DEFAULT_CHANNELS } from './channels.js';
import {
  INPUT_PROFILES,
  KNOWN_PRESETS,
  type AgcConfig,
  type ChannelEqState,
  type InputProfileId,
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
  enableAutoPiLoop?: boolean;
}

export class SoundManager extends EventEmitter {
  public readonly mode: 'production' | 'simulation';
  private channels = new Map<string, MicChannelState>();
  private channelIndexMap = new Map<number, MicChannelState>();
  private currentPreset: RoutingPreset;
  private soundweb: SoundwebClient | SoundwebSimulator;
  private autoPiTimer: NodeJS.Timeout | null = null;
  private channelHoldTimers = new Map<string, number>();

  constructor(options: SoundManagerOptions = {}) {
    super();
    this.mode = options.mode || (process.env.PISOUND_MODE === 'production' ? 'production' : 'simulation');
    this.currentPreset = KNOWN_PRESETS[options.initialPreset || 'normal'];

    const channelConfigs = options.channels || DEFAULT_CHANNELS;
    const now = new Date().toISOString();

    for (const cfg of channelConfigs) {
      const profileKey = cfg.defaultProfile || 'speech';
      const profileDef = INPUT_PROFILES[profileKey];

      const isDefaultOn =
        cfg.id === 'kapula1' || cfg.id === 'wired1' || cfg.id === 'wired3';

      const state: MicChannelState = {
        ...cfg,
        isOn: isDefaultOn,
        volumePercent: profileDef.defaultVolume,
        baseVolumePercent: profileDef.defaultVolume,
        profile: profileKey,
        eq: { ...profileDef.defaultEq },
        agc: { ...profileDef.defaultAgc },
        signalPresent: false,
        peakDbfs: -60, // ambient silence floor
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

    if (options.enableAutoPiLoop !== false) {
      this.startAutoPiLoop();
    }
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
    channel.baseVolumePercent = clamped; // Manual override sets new baseline
    channel.lastChangedAt = new Date().toISOString();

    const packet = buildSetGainPercentPacket(channel.channelIndex, clamped);
    this.soundweb.send(packet);

    this.emit('mic_change', channel);
    return channel;
  }

  /**
   * Applies an Input Profile (e.g. speech, guitar, piano, choir) to an input.
   * Snaps fader, EQ, and AGC parameters to profile defaults.
   */
  public setChannelProfile(id: string, profileId: InputProfileId): MicChannelState {
    const channel = this.channels.get(id);
    if (!channel) {
      throw new Error(`Microphone channel not found: ${id}`);
    }

    const profile = INPUT_PROFILES[profileId];
    if (!profile) {
      throw new Error(`Unknown input profile: ${profileId}`);
    }

    channel.profile = profileId;
    channel.volumePercent = profile.defaultVolume;
    channel.baseVolumePercent = profile.defaultVolume;
    channel.eq = { ...profile.defaultEq };
    channel.agc = { ...profile.defaultAgc };
    channel.lastChangedAt = new Date().toISOString();

    // Send updated fader to Soundweb BLU-100
    this.soundweb.send(buildSetGainPercentPacket(channel.channelIndex, profile.defaultVolume));

    this.emit('mic_change', channel);
    return channel;
  }

  /**
   * Configures AGC / Auto-leveler settings for a channel.
   */
  public setChannelAgc(id: string, patch: Partial<AgcConfig>): MicChannelState {
    const channel = this.channels.get(id);
    if (!channel) {
      throw new Error(`Microphone channel not found: ${id}`);
    }

    channel.agc = { ...channel.agc, ...patch };
    channel.lastChangedAt = new Date().toISOString();

    this.emit('mic_change', channel);
    return channel;
  }

  /**
   * Updates EQ parameters for a channel.
   */
  public setChannelEq(id: string, patch: Partial<ChannelEqState>): MicChannelState {
    const channel = this.channels.get(id);
    if (!channel) {
      throw new Error(`Microphone channel not found: ${id}`);
    }

    channel.eq = { ...channel.eq, ...patch };
    channel.lastChangedAt = new Date().toISOString();

    this.emit('mic_change', channel);
    return channel;
  }

  /**
   * Updates live meter / peak telemetry for a channel (called from BLU meter stream or test harness).
   */
  public updateChannelMeter(id: string, peakDbfs: number): void {
    const channel = this.channels.get(id);
    if (!channel) return;

    channel.peakDbfs = peakDbfs;
    channel.signalPresent = peakDbfs > (channel.agc.noiseGateThresholdDbfs + 4);
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
    if (this.autoPiTimer) {
      clearInterval(this.autoPiTimer);
      this.autoPiTimer = null;
    }
    this.soundweb.destroy();
    this.removeAllListeners();
  }

  /**
   * The "auto-pi" Fader Rider Loop:
   * Runs every 100 ms. Evaluates open mics configured with agc.mode === 'agc-pi'.
   * Rides the virtual fader position smoothly to equalize quiet and loud speakers.
   */
  private startAutoPiLoop(): void {
    const INTERVAL_MS = 100;
    this.autoPiTimer = setInterval(() => {
      this.tickAutoPi(INTERVAL_MS);
    }, INTERVAL_MS);
  }

  public tickAutoPi(deltaMs: number): void {
    const now = Date.now();

    for (const channel of this.channels.values()) {
      if (!channel.isOn || channel.agc.mode !== 'agc-pi') {
        continue;
      }

      const agc = channel.agc;
      const peak = channel.peakDbfs;

      // 1. Noise gate / Silence check: Freeze if room is quiet
      if (peak < agc.noiseGateThresholdDbfs) {
        this.channelHoldTimers.set(channel.id, now);
        continue; // Freeze fader during pauses/silence!
      }

      // 2. Hold timer: Don't snap immediately during speech gaps
      const lastSilence = this.channelHoldTimers.get(channel.id) || 0;
      if (now - lastSilence < agc.holdTimeMs && peak < agc.noiseGateThresholdDbfs + 4) {
        continue;
      }

      // 3. Error delta: Difference between target loudness and current peak
      const errorDb = agc.targetDbfs - peak;

      // Deadband: +/- 1.5 dB does not need adjustment
      if (Math.abs(errorDb) <= 1.5) {
        continue;
      }

      // 4. Compute fader adjustment rate
      let adjustmentPercent = 0;
      if (errorDb > 0) {
        // Voice is too quiet -> Gently ramp up (decay time)
        const ratePerSecond = (6.0 / (agc.decayTimeMs / 1000)); // dB per second
        const stepDb = ratePerSecond * (deltaMs / 1000);
        adjustmentPercent = stepDb * 1.5; // ~1 dB is approx 1.5% fader
      } else {
        // Voice is too loud -> Ramp down faster (attack time)
        const ratePerSecond = (8.0 / (agc.attackTimeMs / 1000));
        const stepDb = ratePerSecond * (deltaMs / 1000);
        adjustmentPercent = -stepDb * 1.5;
      }

      // 5. Apply safety clamps (maxBoostDb & maxCutDb from baseVolumePercent)
      const maxAllowed = Math.min(100, channel.baseVolumePercent + (agc.maxBoostDb * 1.5));
      const minAllowed = Math.max(0, channel.baseVolumePercent - (agc.maxCutDb * 1.5));

      const newVolume = Math.max(minAllowed, Math.min(maxAllowed, channel.volumePercent + adjustmentPercent));

      if (Math.abs(newVolume - channel.volumePercent) >= 0.2) {
        channel.volumePercent = Math.round(newVolume * 10) / 10;
        channel.lastChangedAt = new Date().toISOString();

        // Dispatch updated fader to BLU-100
        this.soundweb.send(buildSetGainPercentPacket(channel.channelIndex, channel.volumePercent));
        this.emit('mic_change', channel);
      }
    }
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
