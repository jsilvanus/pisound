/**
 * Core type definitions for pisound: BSS Soundweb London / HiQnet microphone and audio controller.
 */

export type MicGroup = 'handheld' | 'madonna' | 'wired';

export type MixControlType = 'toggle' | 'gain';

export interface AudioMixConfig {
  id: string; // e.g. 'sali', 'striimi', 'webradio', 'videochat'
  name: string; // e.g. 'Sali (Kirkkosali PA)', 'Striimi (Broadcast)', 'Web Radio'
  controlType: MixControlType; // 'toggle' = On/Off routing only; 'gain' = Fader 0..100% + Mute
  hasMasterFader: boolean;
  defaultMasterVolume: number; // 0..100
  defaultEnabled: boolean; // default channel routing if not explicitly set
  nodeId?: number; // BSS Soundweb Node ID
  objectId?: number[]; // 3-byte BSS Soundweb Object ID
  masterParamId?: number;
}

export interface MixMasterState {
  id: string;
  name: string;
  controlType: MixControlType;
  volumePercent: number; // 0..100%
  isMuted: boolean;
}

export interface ChannelMixSend {
  enabled: boolean; // true = routed/unmuted in this mix; false = muted/off in this mix
  volumePercent: number; // 0..100% (gain in mix; ignored when controlType is 'toggle')
}

export const DEFAULT_MIXES: AudioMixConfig[] = [
  {
    id: 'sali',
    name: 'Sali (Kirkkosali PA)',
    controlType: 'toggle', // On/Off only, no per-channel gain fader
    hasMasterFader: true,
    defaultMasterVolume: 80,
    defaultEnabled: true,
    nodeId: 1,
    objectId: [0x00, 0x01, 0x04], // Mic Mixer (Obj 260)
    masterParamId: 0,
  },
  {
    id: 'striimi',
    name: 'Striimi (YouTube / Broadcast)',
    controlType: 'gain', // Full per-channel gain fader + mute
    hasMasterFader: true,
    defaultMasterVolume: 85,
    defaultEnabled: true,
    nodeId: 1,
    objectId: [0x00, 0x01, 0x4d], // WL Mixer (Obj 333)
    masterParamId: 0,
  },
  {
    id: 'webradio',
    name: 'Web Radio (Nettiradio)',
    controlType: 'gain', // Dedicated gain tap
    hasMasterFader: true,
    defaultMasterVolume: 80,
    defaultEnabled: true,
    nodeId: 1,
    objectId: [0x00, 0x01, 0x68], // RADIO VOL block (Obj 360 in Audio Architect)
    masterParamId: 0, // Gain is svID 0, Mute is svID 1
  },
];

export type InputProfileId =
  | 'speech'
  | 'vocal'
  | 'guitar'
  | 'piano'
  | 'choir'
  | 'organ'
  | 'drums'
  | 'ambient'
  | 'custom';

export interface ChannelEqState {
  hpfEnabled: boolean;
  hpfHz: number; // e.g. 40 - 100 Hz
  lowDb: number; // -12 .. +12 dB
  midHz: number; // e.g. 800 - 3500 Hz
  midDb: number; // -12 .. +12 dB
  highDb: number; // -12 .. +12 dB
  isBypassed: boolean;
}

export type AgcMode = 'none' | 'agc-pi' | 'agc-blu';

export interface AgcConfig {
  mode: AgcMode;
  targetDbfs: number; // Target perceived loudness, e.g. -22 dBFS
  attackTimeMs: number; // Speed of reducing loud voices, e.g. 300 ms
  decayTimeMs: number; // Speed of boosting quiet voices, e.g. 1500 ms
  holdTimeMs: number; // Time to freeze before decaying after voice stops, e.g. 800 ms
  noiseGateThresholdDbfs: number; // Noise floor threshold below which rider freezes, e.g. -42 dBFS
  maxBoostDb: number; // Maximum gain boost clamp, e.g. +6 dB (feedback guard)
  maxCutDb: number; // Maximum cut clamp, e.g. -10 dB
}

export interface InputProfileDefinition {
  id: InputProfileId;
  name: string;
  description: string;
  defaultVolume: number; // 0..100%
  defaultEq: ChannelEqState;
  defaultAgc: AgcConfig;
}

export const DEFAULT_AGC_CONFIG: AgcConfig = {
  mode: 'none',
  targetDbfs: -22,
  attackTimeMs: 300,
  decayTimeMs: 1500,
  holdTimeMs: 800,
  noiseGateThresholdDbfs: -42,
  maxBoostDb: 6,
  maxCutDb: 10,
};

export const INPUT_PROFILES: Record<InputProfileId, InputProfileDefinition> = {
  speech: {
    id: 'speech',
    name: 'Puhe (Speech)',
    description: 'Pappi, lukija, liturgia, saarna. Auto-leveler aktiivinen, HPF 80 Hz.',
    defaultVolume: 75,
    defaultEq: {
      hpfEnabled: true,
      hpfHz: 80,
      lowDb: -1.0,
      midHz: 3000,
      midDb: 2.0,
      highDb: 0.0,
      isBypassed: false,
    },
    defaultAgc: {
      ...DEFAULT_AGC_CONFIG,
      mode: 'agc-pi',
      targetDbfs: -22,
      maxBoostDb: 6,
      maxCutDb: 10,
    },
  },
  vocal: {
    id: 'vocal',
    name: 'Yksinlaulu (Vocal Solo)',
    description: 'Solisti, kanttori. Pehmeä tasonsäätö, HPF 60 Hz.',
    defaultVolume: 72,
    defaultEq: {
      hpfEnabled: true,
      hpfHz: 60,
      lowDb: 0.0,
      midHz: 2500,
      midDb: 1.5,
      highDb: 1.0,
      isBypassed: false,
    },
    defaultAgc: {
      ...DEFAULT_AGC_CONFIG,
      mode: 'agc-pi',
      targetDbfs: -20,
      attackTimeMs: 500,
      decayTimeMs: 2000,
      maxBoostDb: 4,
      maxCutDb: 8,
    },
  },
  guitar: {
    id: 'guitar',
    name: 'Kitara (Guitar)',
    description: 'Akustinen kitara, DI-boksi. Dynaaminen sointi, HPF 50 Hz.',
    defaultVolume: 70,
    defaultEq: {
      hpfEnabled: true,
      hpfHz: 50,
      lowDb: 1.0,
      midHz: 800,
      midDb: -2.0,
      highDb: 1.5,
      isBypassed: false,
    },
    defaultAgc: {
      ...DEFAULT_AGC_CONFIG,
      mode: 'none',
    },
  },
  piano: {
    id: 'piano',
    name: 'Flyygeli / Piano',
    description: 'Kuorin piano, koskettimet. Luonnollinen dynamiikka.',
    defaultVolume: 70,
    defaultEq: {
      hpfEnabled: true,
      hpfHz: 40,
      lowDb: 0.0,
      midHz: 1200,
      midDb: 0.0,
      highDb: 1.0,
      isBypassed: false,
    },
    defaultAgc: {
      ...DEFAULT_AGC_CONFIG,
      mode: 'none',
    },
  },
  choir: {
    id: 'choir',
    name: 'Kuoro (Choir)',
    description: 'Kuoromikrofonit. Moniääninen laulu ilman kompressiopumppausta.',
    defaultVolume: 68,
    defaultEq: {
      hpfEnabled: true,
      hpfHz: 60,
      lowDb: 0.0,
      midHz: 2000,
      midDb: 0.0,
      highDb: 1.5,
      isBypassed: false,
    },
    defaultAgc: {
      ...DEFAULT_AGC_CONFIG,
      mode: 'none',
    },
  },
  organ: {
    id: 'organ',
    name: 'Urut (Organ)',
    description: 'Pääurut ja positiivi. Täysi dynamiikka, ei leikkaa bassoa.',
    defaultVolume: 62,
    defaultEq: {
      hpfEnabled: false,
      hpfHz: 20,
      lowDb: 0.0,
      midHz: 1000,
      midDb: 0.0,
      highDb: 0.0,
      isBypassed: true,
    },
    defaultAgc: {
      ...DEFAULT_AGC_CONFIG,
      mode: 'none',
    },
  },
  drums: {
    id: 'drums',
    name: 'Rummut / Perkussiot',
    description: 'Lyömäsoittimet, cajon. Vaimennettu huippujen varalta.',
    defaultVolume: 55,
    defaultEq: {
      hpfEnabled: true,
      hpfHz: 40,
      lowDb: 2.0,
      midHz: 500,
      midDb: -3.0,
      highDb: 2.0,
      isBypassed: false,
    },
    defaultAgc: {
      ...DEFAULT_AGC_CONFIG,
      mode: 'none',
    },
  },
  ambient: {
    id: 'ambient',
    name: 'Tila / Seurakunta (Ambient)',
    description: 'Akustiikka ja virsilaulu. Taustaääni lähetykseen.',
    defaultVolume: 52,
    defaultEq: {
      hpfEnabled: true,
      hpfHz: 80,
      lowDb: -2.0,
      midHz: 1500,
      midDb: 0.0,
      highDb: 0.0,
      isBypassed: false,
    },
    defaultAgc: {
      ...DEFAULT_AGC_CONFIG,
      mode: 'none',
    },
  },
  custom: {
    id: 'custom',
    name: 'Oma (Custom)',
    description: 'Käyttäjän mukautettu säätö.',
    defaultVolume: 75,
    defaultEq: {
      hpfEnabled: true,
      hpfHz: 80,
      lowDb: 0.0,
      midHz: 1000,
      midDb: 0.0,
      highDb: 0.0,
      isBypassed: false,
    },
    defaultAgc: {
      ...DEFAULT_AGC_CONFIG,
      mode: 'none',
    },
  },
};

export interface MicChannelConfig {
  id: string;
  name: string;
  role: string;
  group: MicGroup;
  channelIndex: number; // 0-based index in DSP mixer
  isWireless: boolean;
  defaultVolume: number; // 0-100%
  defaultProfile?: InputProfileId | undefined;
  nodeId?: number | undefined; // Soundweb London Node ID (default 1)
  objectId?: number[] | undefined; // 3-byte Object ID (e.g. WL Mixer [0,1,0x4d], Mic Mixer [0,1,4])
  gainParamId?: number | undefined; // Harman parameter ID for gain (svID = k * 100)
  muteParamId?: number | undefined; // Harman parameter ID for mute (svID = k * 100 + 1)
}

export interface MicChannelState extends MicChannelConfig {
  isOn: boolean; // true = unmuted / live, false = muted / off
  volumePercent: number; // 0..100% (current active position in default/stream mix)
  baseVolumePercent: number; // Calibrated profile baseline
  profile: InputProfileId;
  eq: ChannelEqState;
  agc: AgcConfig;
  signalPresent: boolean;
  peakDbfs: number; // Instantaneous or RMS meter (-80 to 0)
  lastChangedAt: string;
  mixes: Record<string, ChannelMixSend>; // Per-mix routing and gain (e.g. sali, striimi, webradio)
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
  mixes: MixMasterState[];
  channels: MicChannelState[];
  timestamp: string;
}
