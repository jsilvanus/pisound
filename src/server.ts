import fastify, { type FastifyInstance } from 'fastify';
import { SoundManager } from './manager.js';
import type { MicGroup, RoutingPresetKey } from './types.js';

export interface ServerOptions {
  port?: number;
  host?: string;
  manager?: SoundManager;
}

export function createServer(options: ServerOptions = {}): {
  app: FastifyInstance;
  manager: SoundManager;
  start: () => Promise<string>;
  stop: () => Promise<void>;
} {
  const app = fastify({ logger: false });
  const manager = options.manager ?? new SoundManager();
  const port = options.port ?? parseInt(process.env.PISOUND_PORT || '3300', 10);
  const host = options.host ?? (process.env.PISOUND_HOST || '0.0.0.0');

  // CORS headers
  app.addHook('onRequest', async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      return reply.status(204).send();
    }
  });

  // 1. Health check
  app.get('/health', async () => {
    return { status: 'ok', service: 'pisound' };
  });

  // 2. Full system status snapshot
  app.get('/api/v1/status', async () => {
    return manager.getSnapshot();
  });

  // 3. List microphones (optionally filtered by ?group= or ?wireless=true/false)
  app.get<{ Querystring: { group?: string; wireless?: string } }>('/api/v1/mics', async (req) => {
    let list = manager.getAllChannels();
    if (req.query.group) {
      list = list.filter((c) => c.group === req.query.group);
    }
    if (req.query.wireless !== undefined) {
      const isWireless = req.query.wireless === 'true';
      list = list.filter((c) => c.isWireless === isWireless);
    }
    return { count: list.length, channels: list };
  });

  // 4. Get single microphone state
  app.get<{ Params: { id: string } }>('/api/v1/mics/:id', async (req, reply) => {
    const ch = manager.getChannel(req.params.id);
    if (!ch) {
      return reply.status(404).send({ error: `Microphone '${req.params.id}' not found` });
    }
    return ch;
  });

  // 5. Set mic state (ON / OFF)
  app.post<{ Params: { id: string }; Body: { on: boolean } }>('/api/v1/mics/:id/state', async (req, reply) => {
    if (typeof req.body?.on !== 'boolean') {
      return reply.status(400).send({ error: "Missing boolean field 'on'" });
    }
    try {
      const updated = manager.setMicState(req.params.id, req.body.on);
      return { ok: true, channel: updated };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(404).send({ error: message });
    }
  });

  // 6. Toggle mic state
  app.post<{ Params: { id: string } }>('/api/v1/mics/:id/toggle', async (req, reply) => {
    try {
      const updated = manager.toggleMic(req.params.id);
      return { ok: true, channel: updated };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(404).send({ error: message });
    }
  });

  // 7. Solo mic (Turns ON target, mutes all others in group/wireless)
  app.post<{ Params: { id: string } }>('/api/v1/mics/:id/solo', async (req, reply) => {
    try {
      const updated = manager.soloMic(req.params.id);
      return { ok: true, solo: updated.id, channel: updated };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(404).send({ error: message });
    }
  });

  // 8. Set mic volume
  app.post<{ Params: { id: string }; Body: { volumePercent: number } }>('/api/v1/mics/:id/volume', async (req, reply) => {
    if (typeof req.body?.volumePercent !== 'number') {
      return reply.status(400).send({ error: "Missing numeric field 'volumePercent'" });
    }
    try {
      const updated = manager.setMicVolume(req.params.id, req.body.volumePercent);
      return { ok: true, channel: updated };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(404).send({ error: message });
    }
  });

  // 9. Bulk mute group
  app.post<{ Params: { group: string } }>('/api/v1/groups/:group/mute-all', async (req, reply) => {
    const validGroups = ['handheld', 'madonna', 'wired', 'wireless', 'all'];
    if (!validGroups.includes(req.params.group)) {
      return reply.status(400).send({ error: `Invalid group '${req.params.group}'. Valid: ${validGroups.join(', ')}` });
    }
    manager.muteGroup(req.params.group as MicGroup | 'wireless' | 'all');
    return { ok: true, group: req.params.group, action: 'muted_all' };
  });

  // 10. Bulk unmute group
  app.post<{ Params: { group: string } }>('/api/v1/groups/:group/unmute-all', async (req, reply) => {
    const validGroups = ['handheld', 'madonna', 'wired', 'wireless', 'all'];
    if (!validGroups.includes(req.params.group)) {
      return reply.status(400).send({ error: `Invalid group '${req.params.group}'. Valid: ${validGroups.join(', ')}` });
    }
    manager.unmuteGroup(req.params.group as MicGroup | 'wireless' | 'all');
    return { ok: true, group: req.params.group, action: 'unmuted_all' };
  });

  // 11. Recall preset
  app.post<{ Params: { preset: string } }>('/api/v1/presets/:preset', async (req, reply) => {
    const pStr = req.params.preset;
    const asNum = parseInt(pStr, 10);
    try {
      const preset = isNaN(asNum)
        ? manager.recallPreset(pStr as RoutingPresetKey)
        : manager.recallPreset(asNum);
      return { ok: true, preset };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: message });
    }
  });

  // 12. Server-Sent Events (SSE) stream for live updates
  app.get('/api/v1/events', (req, reply) => {
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.flushHeaders();

    // Send initial snapshot
    const initial = JSON.stringify({ type: 'snapshot', data: manager.getSnapshot() });
    reply.raw.write(`event: snapshot\ndata: ${initial}\n\n`);

    const onMicChange = (channel: unknown) => {
      reply.raw.write(`event: mic_change\ndata: ${JSON.stringify(channel)}\n\n`);
    };

    const onPresetChange = (preset: unknown) => {
      reply.raw.write(`event: preset_change\ndata: ${JSON.stringify(preset)}\n\n`);
    };

    const onBulkChange = (bulk: unknown) => {
      reply.raw.write(`event: bulk_change\ndata: ${JSON.stringify(bulk)}\n\n`);
    };

    manager.on('mic_change', onMicChange);
    manager.on('preset_change', onPresetChange);
    manager.on('bulk_change', onBulkChange);

    req.raw.on('close', () => {
      manager.off('mic_change', onMicChange);
      manager.off('preset_change', onPresetChange);
      manager.off('bulk_change', onBulkChange);
    });
  });

  return {
    app,
    manager,
    start: async () => {
      await app.listen({ port, host });
      return `http://${host}:${port}`;
    },
    stop: async () => {
      manager.close();
      await app.close();
    },
  };
}
