/**
 * Core type definitions for pisound: BSS Soundweb London / HiQnet microphone and audio controller.
 */

export type MicGroup = 'handheld' | 'madonna' | 'wired';

export interface MicChannelConfig {
  id: string;
  name: string;
  role: string;
  group: MicGroup;
  channelIndex: number; // 0-based index in DSP mixer
  isWireless: boolean;
  defaultVolume: number; // 0-100%
}

export interface MicChannelState extends MicChannelConfig {
  isOn: boolean; // true = unmuted / live, false = muted / off
  volumePercent: number; // 0..100
  signalPresent: boolean;
  lastChangedAt: string;
}

export type RoutingPresetKey = 'mixer' | 'normal' | 'open' | 'mute';

export interface RoutingPreset {
  id: number;
  key: RoutingPresetKey;
  name: string;
  description: string;
}

export const KNOWN_PRESETS: Record<RoutingPresetKey, RoutingPreset> = {
  normal: {
    id: 1,
    key: 'normal',
    name: 'WL Normaali (Automixer)',
    description: 'Wireless mics route directly to sanctuary speaker zones via automixer',
  },
  mixer: {
    id: 0,
    key: 'mixer',
    name: 'WL Mikseriin (SQ-5)',
    description: 'Wireless mics route through the Allen & Heath SQ-5 FOH console',
  },
  open: {
    id: 3,
    key: 'open',
    name: 'Audio Open',
    description: 'Unmutes system master outputs (startup preset)',
  },
  mute: {
    id: 4,
    key: 'mute',
    name: 'Audio Mute',
    description: 'Mutes system master outputs (shutdown preset)',
  },
};

export type SoundwebConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'simulated';

export interface SystemSoundSnapshot {
  service: 'pisound';
  status: SoundwebConnectionStatus;
  host: string;
  port: number;
  mode: 'production' | 'simulation';
  currentPreset: RoutingPreset;
  activeWirelessCount: number;
  activeWiredCount: number;
  channels: MicChannelState[];
  timestamp: string;
}

export interface SoundEventPayload {
  event: 'mic_state' | 'volume' | 'preset' | 'status' | 'bulk';
  channelId?: string;
  group?: MicGroup | 'wireless' | 'all';
  data: unknown;
  timestamp: string;
}
