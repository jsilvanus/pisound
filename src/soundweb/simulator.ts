import { EventEmitter } from 'node:events';
import { decodePacket, MSG_RECALL_PARAM_PRESET, MSG_SET, MSG_SET_PERCENT } from '../protocol/london-di.js';
import type { SoundwebConnectionStatus } from '../types.js';

/**
 * In-memory simulator for BSS Soundweb London BLU-100.
 * Allows pisound to run in simulation mode without physical hardware.
 */
export class SoundwebSimulator extends EventEmitter {
  private status: SoundwebConnectionStatus = 'simulated';

  public getStatus(): SoundwebConnectionStatus {
    return this.status;
  }

  public connect(): void {
    this.status = 'simulated';
    this.emit('connected', { host: 'simulated', port: 1023 });
  }

  public disconnect(): void {
    this.status = 'disconnected';
    this.emit('status_change', 'disconnected');
  }

  public destroy(): void {
    this.disconnect();
    this.removeAllListeners();
  }

  public send(packet: Buffer): boolean {
    const body = decodePacket(packet);
    if (!body) return false;

    const msgType = body[0];
    const objId = body.subarray(4, 7);
    if (msgType === MSG_RECALL_PARAM_PRESET) {
      const presetId = body.readUInt32BE(1);
      this.emit('sim_preset', presetId);
    } else if (msgType === MSG_SET) {
      const paramId = body.readUInt16BE(7);
      const val = body.readUInt32BE(9);
      const isMuted = val !== 0;
      this.emit('sim_mute', { objId, paramId, isMuted });
    } else if (msgType === MSG_SET_PERCENT) {
      const paramId = body.readUInt16BE(7);
      const scaledVal = body.readUInt32BE(9);
      const volumePercent = Math.round((scaledVal / 65536) * 100);
      this.emit('sim_volume', { objId, paramId, volumePercent });
    }

    return true;
  }
}
