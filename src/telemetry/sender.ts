import dgram from 'node:dgram';
import { EventEmitter } from 'node:events';
import type { SoundManager } from '../manager.js';
import {
  encodePisoundTelemetryPacket,
  type PisoundTelemetryPayload,
  type TelemetryChannelInput,
  type TelemetryMixSummary,
} from './packet.js';

export interface TelemetrySenderOptions {
  host?: string | undefined;
  port?: number | undefined;
  intervalMs?: number | undefined; // default 100 ms (10 Hz)
  enabled?: boolean | undefined;
}

export class TelemetrySender extends EventEmitter {
  public readonly host: string;
  public readonly port: number;
  public readonly intervalMs: number;
  private socket: dgram.Socket | null = null;
  private timer: NodeJS.Timeout | null = null;
  private sequence = 0;
  private manager: SoundManager;
  private isRunning = false;

  constructor(manager: SoundManager, options: TelemetrySenderOptions = {}) {
    super();
    this.manager = manager;
    this.host = options.host || process.env.PISOUND_GATEWAY_HOST || '127.0.0.1';
    this.port = options.port || parseInt(process.env.PISOUND_GATEWAY_PORT || '3102', 10);
    this.intervalMs = options.intervalMs || 100;
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.socket = dgram.createSocket('udp4');
    this.socket.on('error', (err) => {
      this.emit('error', err);
    });

    this.timer = setInterval(() => {
      this.tick();
    }, this.intervalMs);

    this.timer.unref();
  }

  public stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        // ignore close errors
      }
      this.socket = null;
    }
  }

  public tick(): void {
    if (!this.socket || !this.isRunning) return;

    const payload = this.buildPayload();
    const packet = encodePisoundTelemetryPacket(payload);

    this.socket.send(packet, 0, packet.length, this.port, this.host, (err) => {
      if (err) {
        this.emit('send_error', err);
      } else {
        this.emit('sent', { sequence: payload.sequence, bytes: packet.length });
      }
    });
  }

  public buildPayload(): PisoundTelemetryPayload {
    this.sequence = (this.sequence + 1) >>> 0;
    const now = Date.now();

    const mixes: TelemetryMixSummary[] = this.manager.getMixMasterStates().map((m) => ({
      id: m.id,
      controlType: m.controlType,
      masterVolume: m.volumePercent,
      masterMuted: m.isMuted,
    }));

    const channels = this.manager.getAllChannels();
    let activeTalkersMask = 0;

    const channelInputs: TelemetryChannelInput[] = channels.map((ch) => {
      if (ch.signalPresent && ch.channelIndex < 32) {
        activeTalkersMask |= 1 << ch.channelIndex;
      }

      const mixSends: Record<string, { enabled: boolean; volumePercent: number }> = {};
      for (const [mixId, send] of Object.entries(ch.mixes)) {
        mixSends[mixId] = {
          enabled: send.enabled,
          volumePercent: send.volumePercent,
        };
      }

      return {
        channelIndex: ch.channelIndex,
        peakMilliDbfs: Math.round(ch.peakDbfs * 1000),
        profile: ch.profile,
        signalPresent: ch.signalPresent,
        agcActive: ch.agc.mode !== 'none' && ch.signalPresent,
        isOn: ch.isOn,
        mixSends,
      };
    });

    return {
      sequence: this.sequence,
      timestamp: now,
      activeTalkersMask,
      mixes,
      channels: channelInputs,
    };
  }
}
