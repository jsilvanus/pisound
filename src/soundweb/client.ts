import net from 'node:net';
import { EventEmitter } from 'node:events';
import { decodePacket, STX, ETX } from '../protocol/london-di.js';
import type { SoundwebConnectionStatus } from '../types.js';

export interface SoundwebClientOptions {
  host?: string;
  port?: number;
  reconnectIntervalMs?: number;
  connectTimeoutMs?: number;
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
  private connectTimeoutMs: number;
  private isDestroyed = false;
  public lastError: string | null = null;
  public lastConnectedAt: string | null = null;
  public lastAttemptAt: string | null = null;

  constructor(options: SoundwebClientOptions = {}) {
    super();
    this.host = options.host || process.env.PISOUND_SOUNDWEB_HOST || '192.168.1.30';
    this.port = options.port || parseInt(process.env.PISOUND_SOUNDWEB_PORT || '1023', 10);
    this.reconnectIntervalMs = options.reconnectIntervalMs || parseInt(process.env.PISOUND_RECONNECT_MS || '30000', 10);
    this.connectTimeoutMs = options.connectTimeoutMs || 5000;

    if (options.autoConnect !== false) {
      this.connect();
    }
  }

  public getStatus(): SoundwebConnectionStatus {
    return this.status;
  }

  public async probe(timeoutMs = 1500): Promise<{ reachable: boolean; latencyMs?: number; error?: string }> {
    if (this.status === 'connected') {
      return { reachable: true, latencyMs: 1 };
    }
    const start = Date.now();
    return new Promise((resolve) => {
      const probeSocket = new net.Socket();
      probeSocket.setTimeout(timeoutMs);

      const cleanup = () => {
        probeSocket.removeAllListeners();
        probeSocket.destroy();
      };

      probeSocket.once('connect', () => {
        const latencyMs = Date.now() - start;
        cleanup();
        resolve({ reachable: true, latencyMs });
      });

      probeSocket.once('timeout', () => {
        cleanup();
        resolve({ reachable: false, error: `Connection timed out after ${timeoutMs}ms` });
      });

      probeSocket.once('error', (err) => {
        cleanup();
        resolve({ reachable: false, error: err.message });
      });

      try {
        probeSocket.connect(this.port, this.host);
      } catch (err: unknown) {
        cleanup();
        resolve({ reachable: false, error: err instanceof Error ? err.message : String(err) });
      }
    });
  }

  public connect(): void {
    if (this.isDestroyed || this.socket) return;

    this.setStatus('connecting');
    this.lastAttemptAt = new Date().toISOString();
    const socket = new net.Socket();
    this.socket = socket;
    // An unreachable host (device powered off) must fail fast and be retried later.
    socket.setTimeout(this.connectTimeoutMs, () => socket.destroy(new Error('connect timeout')));

    socket.connect(this.port, this.host, () => {
      socket.setTimeout(0);
      this.lastError = null;
      this.lastConnectedAt = new Date().toISOString();
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
      // An offline DSP is normal (it is off with the AV system). Record it and let
      // 'close' schedule the retry; never emit 'error' without a listener (that throws).
      this.lastError = err.message;
      this.emit('connect_error', err);
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
      this.lastError = err instanceof Error ? err.message : String(err);
      this.emit('connect_error', err);
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
