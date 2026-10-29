import net from 'node:net';
import { EventEmitter } from 'node:events';
import { decodePacket, STX, ETX } from '../protocol/london-di.js';
import type { SoundwebConnectionStatus } from '../types.js';

export interface SoundwebClientOptions {
  host?: string;
  port?: number;
  reconnectIntervalMs?: number;
  autoConnect?: boolean;
}

export class SoundwebClient extends EventEmitter {
  public host: string;
  public port: number;
  private reconnectIntervalMs: number;
  private socket: net.Socket | null = null;
  private status: SoundwebConnectionStatus = 'disconnected';
  private incomingBuffer: Buffer = Buffer.alloc(0);
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isDestroyed = false;

  constructor(options: SoundwebClientOptions = {}) {
    super();
    this.host = options.host || process.env.PISOUND_SOUNDWEB_HOST || '192.168.1.30';
    this.port = options.port || parseInt(process.env.PISOUND_SOUNDWEB_PORT || '1023', 10);
    this.reconnectIntervalMs = options.reconnectIntervalMs || 5000;

    if (options.autoConnect !== false) {
      this.connect();
    }
  }

  public getStatus(): SoundwebConnectionStatus {
    return this.status;
  }

  public connect(): void {
    if (this.isDestroyed || this.socket) return;

    this.setStatus('connecting');
    const socket = new net.Socket();
    this.socket = socket;

    socket.connect(this.port, this.host, () => {
      this.setStatus('connected');
      this.incomingBuffer = Buffer.alloc(0);
      this.emit('connected', { host: this.host, port: this.port });
    });

    socket.on('data', (chunk) => {
      this.handleIncomingData(chunk);
    });

    socket.on('close', () => {
      this.socket = null;
      this.setStatus('disconnected');
      this.scheduleReconnect();
    });

    socket.on('error', (err) => {
      this.emit('error', err);
    });
  }

  public disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.setStatus('disconnected');
  }

  public destroy(): void {
    this.isDestroyed = true;
    this.disconnect();
    this.removeAllListeners();
  }

  public send(packet: Buffer): boolean {
    if (!this.socket || this.status !== 'connected') {
      return false;
    }
    try {
      this.socket.write(packet);
      return true;
    } catch (err) {
      this.emit('error', err);
      return false;
    }
  }

  private handleIncomingData(chunk: Buffer): void {
    this.incomingBuffer = Buffer.concat([this.incomingBuffer, chunk]);

    while (this.incomingBuffer.length >= 4) {
      const startIndex = this.incomingBuffer.indexOf(STX);
      if (startIndex === -1) {
        // No STX found, discard buffer
        this.incomingBuffer = Buffer.alloc(0);
        break;
      }

      const endIndex = this.incomingBuffer.indexOf(ETX, startIndex + 1);
      if (endIndex === -1) {
        // Incomplete packet; keep from startIndex
        this.incomingBuffer = this.incomingBuffer.subarray(startIndex);
        break;
      }

      const rawPacket = this.incomingBuffer.subarray(startIndex, endIndex + 1);
      this.incomingBuffer = this.incomingBuffer.subarray(endIndex + 1);

      const decodedBody = decodePacket(rawPacket);
      if (decodedBody) {
        this.emit('message', decodedBody);
      } else {
        this.emit('corrupt_packet', rawPacket);
      }
    }
  }

  private setStatus(newStatus: SoundwebConnectionStatus): void {
    if (this.status !== newStatus) {
      this.status = newStatus;
      this.emit('status_change', newStatus);
    }
  }

  private scheduleReconnect(): void {
    if (this.isDestroyed || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectIntervalMs);
  }
}
