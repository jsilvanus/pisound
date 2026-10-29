import { EventEmitter } from 'node:events';
import { DEFAULT_CHANNELS } from './channels.js';
import {
  DEFAULT_MIXES,
  INPUT_PROFILES,
  KNOWN_PRESETS,
  type AgcConfig,
  type AudioMixConfig,
  type ChannelEqState,
  type ChannelMixSend,
  type InputProfileId,
  type MicChannelConfig,
  type MicChannelState,
  type MicGroup,
  type MixMasterState,
  type RoutingPreset,
  type RoutingPresetKey,
  type SoundwebConnectionStatus,
  type SystemSoundSnapshot,
} from './types.js';
import {
  BSS_OBJECT_IDS,
  DEFAULT_NODE_ID,
  DEFAULT_OBJECT_ID,
  MSG_SET,
  MSG_SET_PERCENT,
  buildRecallPresetPacket,
  buildSetGainPercentPacket,
  buildSetMutePacket,
  paramIdForChannelGain,
  paramIdForChannelMute,
} from './protocol/london-di.js';
import { SoundwebClient } from './soundweb/client.js';
import { SoundwebSimulator } from './soundweb/simulator.js';

export interface SoundManagerOptions {
  mode?: 'production' | 'simulation';
  host?: string;
  port?: number;
  channels?: MicChannelConfig[];
  mixes?: AudioMixConfig[];
  initialPreset?: RoutingPresetKey;
  enableAutoPiLoop?: boolean;
}

export class SoundManager extends EventEmitter {
  public readonly mode: 'production' | 'simulation';
  private channels = new Map<string, MicChannelState>();
  private channelIndexMap = new Map<number, MicChannelState>();
  private mixConfigs = new Map<string, AudioMixConfig>();
  private mixMasterStates = new Map<string, MixMasterState>();
  private currentPreset: RoutingPreset;
  private soundweb: SoundwebClient | SoundwebSimulator;
  private autoPiTimer: NodeJS.Timeout | null = null;
  private channelHoldTimers = new Map<string, number>();

  constructor(options: SoundManagerOptions = {}) {
    super();
    this.mode = options.mode || (process.env.PISOUND_MODE === 'production' ? 'production' : 'simulation');
    this.currentPreset = KNOWN_PRESETS[options.initialPreset || 'normal'];

    // 1. Configure audio mixes (Sali, Striimi, WebRadio, or custom)
    const mixList = options.mixes || DEFAULT_MIXES;
    for (const mix of mixList) {
      this.mixConfigs.set(mix.id, mix);
      this.mixMasterStates.set(mix.id, {
        id: mix.id,
        name: mix.name,
        controlType: mix.controlType,
        volumePercent: mix.defaultMasterVolume,
        isMuted: false,
      });
    }

    // 2. Configure channels
    const channelConfigs = options.channels || DEFAULT_CHANNELS;
    const now = new Date().toISOString();

    for (const cfg of channelConfigs) {
      const profileKey = cfg.defaultProfile || 'speech';
      const profileDef = INPUT_PROFILES[profileKey];

      const isDefaultOn =
        cfg.id === 'kapula1' || cfg.id === 'wired1' || cfg.id === 'wired3';

      // Build mix routing table for this channel
      const channelMixes: Record<string, ChannelMixSend> = {};
      for (const mix of this.mixConfigs.values()) {
        let enabled = mix.defaultEnabled;
        let volumePercent = profileDef.defaultVolume;

        // Specific church acoustic rule: Ambient mic (wired12 Parvi) must NEVER route into Sali (PA)!
        if (cfg.id === 'wired12' && mix.id === 'sali') {
          enabled = false;
          volumePercent = 0;
        } else if (mix.id === 'sali') {
          enabled = isDefaultOn;
          volumePercent = 100; // Sali is toggle only (no per-channel gain fader)
        }

        channelMixes[mix.id] = { enabled, volumePercent };
      }

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
        mixes: channelMixes,
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
      mixes: this.getMixMasterStates(),
      channels: channelList,
      timestamp: new Date().toISOString(),
    };
  }

  public getMixes(): AudioMixConfig[] {
    return Array.from(this.mixConfigs.values());
  }

  public getMixMasterStates(): MixMasterState[] {
    return Array.from(this.mixMasterStates.values());
  }

  public getMix(mixId: string): {
    config: AudioMixConfig;
    master: MixMasterState;
    channels: Array<{
      id: string;
      name: string;
      role: string;
      group: MicGroup;
      channelIndex: number;
      send: ChannelMixSend;
      peakDbfs: number;
    }>;
  } {
    const config = this.mixConfigs.get(mixId);
    const master = this.mixMasterStates.get(mixId);
    if (!config || !master) {
      throw new Error(`Unknown mix: ${mixId}`);
    }

    const channels = Array.from(this.channels.values()).map((ch) => ({
      id: ch.id,
      name: ch.name,
      role: ch.role,
      group: ch.group,
      channelIndex: ch.channelIndex,
      send: ch.mixes[mixId] || { enabled: false, volumePercent: 0 },
      peakDbfs: ch.peakDbfs,
    }));

    return { config, master, channels };
  }

  public setMixMasterVolume(mixId: string, volumePercent: number): MixMasterState {
    const master = this.mixMasterStates.get(mixId);
    const config = this.mixConfigs.get(mixId);
    if (!master || !config) {
      throw new Error(`Unknown mix: ${mixId}`);
    }

    const clamped = Math.max(0, Math.min(100, Math.round(volumePercent)));
    master.volumePercent = clamped;

    if (config.objectId) {
      const objId = Buffer.from(config.objectId);
      const paramId = config.masterParamId ?? 0;
      this.soundweb.send(buildSetGainPercentPacket(paramId, clamped, config.nodeId, objId));
    }

    this.emit('mix_master_change', master);
    return master;
  }

  public setMixMasterMute(mixId: string, isMuted: boolean): MixMasterState {
    const master = this.mixMasterStates.get(mixId);
    const config = this.mixConfigs.get(mixId);
    if (!master || !config) {
      throw new Error(`Unknown mix: ${mixId}`);
    }

    master.isMuted = isMuted;

    if (config.objectId) {
      const objId = Buffer.from(config.objectId);
      const paramId = (config.masterParamId ?? 0) + 1;
      this.soundweb.send(buildSetMutePacket(paramId, isMuted, config.nodeId, objId));
    }

    this.emit('mix_master_change', master);
    return master;
  }

  public setMixChannel(
    mixId: string,
    channelId: string,
    send: { enabled?: boolean; volumePercent?: number }
  ): ChannelMixSend {
    const config = this.mixConfigs.get(mixId);
    if (!config) {
      throw new Error(`Unknown mix: ${mixId}`);
    }

    const channel = this.channels.get(channelId);
    if (!channel) {
      throw new Error(`Microphone channel not found: ${channelId}`);
    }

    // Enforce toggle vs gain rules
    if (config.controlType === 'toggle') {
      if (send.volumePercent !== undefined) {
        throw new Error(
          `Mix '${mixId}' (${config.name}) is a toggle mix (on/off routing only); per-channel gain faders are not supported.`
        );
      }
    }

    const currentSend = channel.mixes[mixId] || {
      enabled: config.defaultEnabled,
      volumePercent: config.controlType === 'toggle' ? 100 : 75,
    };

    if (send.enabled !== undefined) {
      currentSend.enabled = send.enabled;
    }

    if (send.volumePercent !== undefined && config.controlType === 'gain') {
      currentSend.volumePercent = Math.max(0, Math.min(100, Math.round(send.volumePercent)));
    }

    channel.mixes[mixId] = currentSend;
    channel.lastChangedAt = new Date().toISOString();

    // If setting default stream mix, keep top-level volumePercent in sync
    if (mixId === 'striimi') {
      channel.volumePercent = currentSend.volumePercent;
      channel.baseVolumePercent = currentSend.volumePercent;
      this.soundweb.send(buildSetGainPercentPacket(channel.channelIndex, currentSend.volumePercent));
    }

    this.emit('mix_channel_change', { mixId, channelId, send: currentSend });
    this.emit('mic_change', channel);
    return currentSend;
  }

  public toggleMixChannel(mixId: string, channelId: string): ChannelMixSend {
    const channel = this.channels.get(channelId);
    if (!channel) {
      throw new Error(`Microphone channel not found: ${channelId}`);
    }
    const current = channel.mixes[mixId];
    const newEnabled = current ? !current.enabled : true;
    return this.setMixChannel(mixId, channelId, { enabled: newEnabled });
  }

  public getChannel(id: string): MicChannelState | undefined {
    return this.channels.get(id);
  }

  public getAllChannels(): MicChannelState[] {
    return Array.from(this.channels.values());
  }

  private getChannelSendParams(ch: MicChannelConfig) {
    const nodeId = ch.nodeId ?? DEFAULT_NODE_ID;
    const objectId = ch.objectId ? Buffer.from(ch.objectId) : DEFAULT_OBJECT_ID;
    const muteParam = ch.muteParamId ?? paramIdForChannelMute(ch.channelIndex);
    const gainParam = ch.gainParamId ?? paramIdForChannelGain(ch.channelIndex);
    return { nodeId, objectId, muteParam, gainParam };
  }

  public setMicState(id: string, isOn: boolean): MicChannelState {
    const channel = this.channels.get(id);
    if (!channel) {
      throw new Error(`Microphone channel not found: ${id}`);
    }

    channel.isOn = isOn;
    channel.lastChangedAt = new Date().toISOString();

    const isMuted = !isOn;
    const { nodeId, objectId, muteParam } = this.getChannelSendParams(channel);
    const packet = buildSetMutePacket(muteParam, isMuted, nodeId, objectId);
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

        // Update mix sends: mute in sali and striimi, preserving ambient mic (wired12) in striimi/webradio
        for (const mixId of Object.keys(ch.mixes)) {
          if (ch.id === 'wired12' && (mixId === 'striimi' || mixId === 'webradio')) {
            continue; // Ambient room mic stays live on stream!
          }
          ch.mixes[mixId]!.enabled = false;
        }

        const { nodeId, objectId, muteParam } = this.getChannelSendParams(ch);
        const packet = buildSetMutePacket(muteParam, true, nodeId, objectId);
        this.soundweb.send(packet);
        this.emit('mic_change', ch);
      }
    }

    // Turn target ON
    target.isOn = true;
    target.lastChangedAt = now;
    for (const mixId of Object.keys(target.mixes)) {
      if (target.id === 'wired12' && mixId === 'sali') {
        continue; // Never route ambient mic into Sali (PA feedback guard)
      }
      target.mixes[mixId]!.enabled = true;
    }

    const { nodeId, objectId, muteParam } = this.getChannelSendParams(target);
    const packet = buildSetMutePacket(muteParam, false, nodeId, objectId);
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

    const { nodeId, objectId, gainParam } = this.getChannelSendParams(channel);
    const packet = buildSetGainPercentPacket(gainParam, clamped, nodeId, objectId);
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
    const { nodeId, objectId, gainParam } = this.getChannelSendParams(channel);
    this.soundweb.send(buildSetGainPercentPacket(gainParam, profile.defaultVolume, nodeId, objectId));

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
        const { nodeId, objectId, gainParam } = this.getChannelSendParams(channel);
        this.soundweb.send(buildSetGainPercentPacket(gainParam, channel.volumePercent, nodeId, objectId));
        this.emit('mic_change', channel);
      }
    }
  }

  private setupSoundwebListeners(): void {
    this.soundweb.on('status_change', (status: SoundwebConnectionStatus) => {
      this.emit('connection_change', status);
    });

    // Two-way synchronization: handle parameter changes arriving from physical DSP (AMX, iPad Mika)
    this.soundweb.on('message', (body: Buffer) => {
      this.handleIncomingLondonDi(body);
    });

    if (this.soundweb instanceof SoundwebSimulator) {
      this.soundweb.on('sim_mute', ({ paramId, isMuted }) => {
        const ch = Array.from(this.channels.values()).find(
          (c) => c.muteParamId === paramId || c.channelIndex === paramId
        );
        if (ch) {
          ch.isOn = !isMuted;
          ch.lastChangedAt = new Date().toISOString();
          this.emit('mic_change', ch);
        }
      });
      this.soundweb.on('sim_volume', ({ paramId, volumePercent }) => {
        const ch = Array.from(this.channels.values()).find(
          (c) => c.gainParamId === paramId || c.channelIndex === paramId
        );
        if (ch) {
          ch.volumePercent = volumePercent;
          ch.lastChangedAt = new Date().toISOString();
          this.emit('mic_change', ch);
        }
      });
    }
  }

  private handleIncomingLondonDi(body: Buffer): void {
    if (body.length < 13) return;
    const msgType = body[0];
    const objId = body.subarray(4, 7);
    const paramId = body.readUInt16BE(7);
    const val = body.readUInt32BE(9);

    if (msgType === MSG_SET) {
      const isMuted = val !== 0;
      for (const ch of this.channels.values()) {
        const chObj = ch.objectId ? Buffer.from(ch.objectId) : DEFAULT_OBJECT_ID;
        const chMuteParam = ch.muteParamId ?? paramIdForChannelMute(ch.channelIndex);
        if (chObj.equals(objId) && chMuteParam === paramId) {
          ch.isOn = !isMuted;
          ch.lastChangedAt = new Date().toISOString();
          this.emit('mic_change', ch);
          break;
        }
      }
    } else if (msgType === MSG_SET_PERCENT) {
      const volumePercent = Math.round((val / 65536) * 100);
      for (const ch of this.channels.values()) {
        const chObj = ch.objectId ? Buffer.from(ch.objectId) : DEFAULT_OBJECT_ID;
        const chGainParam = ch.gainParamId ?? paramIdForChannelGain(ch.channelIndex);
        if (chObj.equals(objId) && chGainParam === paramId) {
          ch.volumePercent = volumePercent;
          ch.baseVolumePercent = volumePercent;
          ch.lastChangedAt = new Date().toISOString();
          this.emit('mic_change', ch);
          break;
        }
      }
    }
  }
}
