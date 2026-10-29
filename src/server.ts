import fastify, { type FastifyInstance } from 'fastify';
import { SoundManager } from './manager.js';
import { TelemetrySender } from './telemetry/sender.js';
import {
  INPUT_PROFILES,
  type AgcConfig,
  type ChannelEqState,
  type InputProfileId,
  type MicGroup,
  type RoutingPresetKey,
} from './types.js';

export interface ServerOptions {
  port?: number | undefined;
  host?: string | undefined;
  manager?: SoundManager | undefined;
  enableTelemetry?: boolean | undefined;
  telemetryHost?: string | undefined;
  telemetryPort?: number | undefined;
}

export function createServer(options: ServerOptions = {}): {
  app: FastifyInstance;
  manager: SoundManager;
  telemetrySender?: TelemetrySender | undefined;
  start: () => Promise<string>;
  stop: () => Promise<void>;
} {
  const app = fastify({ logger: false });
  const manager = options.manager ?? new SoundManager();
  const port = options.port ?? parseInt(process.env.PISOUND_PORT || '3300', 10);
  const host = options.host ?? (process.env.PISOUND_HOST || '0.0.0.0');

  let telemetrySender: TelemetrySender | undefined;
  if (options.enableTelemetry !== false && process.env.PISOUND_TELEMETRY !== '0') {
    telemetrySender = new TelemetrySender(manager, {
      host: options.telemetryHost,
      port: options.telemetryPort,
    });
  }

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

  // 3. List available input profiles
  app.get('/api/v1/profiles', async () => {
    return { profiles: Object.values(INPUT_PROFILES) };
  });

  // 4. List microphones (optionally filtered by ?group= or ?wireless=true/false)
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

  // 5. Get single microphone state
  app.get<{ Params: { id: string } }>('/api/v1/mics/:id', async (req, reply) => {
    const ch = manager.getChannel(req.params.id);
    if (!ch) {
      return reply.status(404).send({ error: `Microphone '${req.params.id}' not found` });
    }
    return ch;
  });

  // 6. Set mic state (ON / OFF)
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

  // 7. Toggle mic state
  app.post<{ Params: { id: string } }>('/api/v1/mics/:id/toggle', async (req, reply) => {
    try {
      const updated = manager.toggleMic(req.params.id);
      return { ok: true, channel: updated };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(404).send({ error: message });
    }
  });

  // 8. Solo mic
  app.post<{ Params: { id: string } }>('/api/v1/mics/:id/solo', async (req, reply) => {
    try {
      const updated = manager.soloMic(req.params.id);
      return { ok: true, solo: updated.id, channel: updated };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(404).send({ error: message });
    }
  });

  // 9. Set mic volume (fader)
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

  // 10. Assign input profile to mic (e.g. speech, vocal, guitar, piano, choir, organ, drums)
  app.post<{ Params: { id: string }; Body: { profile: InputProfileId } }>('/api/v1/mics/:id/profile', async (req, reply) => {
    if (!req.body?.profile) {
      return reply.status(400).send({ error: "Missing string field 'profile'" });
    }
    try {
      const updated = manager.setChannelProfile(req.params.id, req.body.profile);
      return { ok: true, channel: updated };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: message });
    }
  });

  // 11. Get & Set AGC settings for a mic
  app.get<{ Params: { id: string } }>('/api/v1/mics/:id/agc', async (req, reply) => {
    const ch = manager.getChannel(req.params.id);
    if (!ch) return reply.status(404).send({ error: `Microphone '${req.params.id}' not found` });
    return { id: ch.id, name: ch.name, agc: ch.agc };
  });

  app.post<{ Params: { id: string }; Body: Partial<AgcConfig> }>('/api/v1/mics/:id/agc', async (req, reply) => {
    try {
      const updated = manager.setChannelAgc(req.params.id, req.body || {});
      return { ok: true, id: updated.id, agc: updated.agc };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: message });
    }
  });

  // 12. Get & Set EQ settings for a mic
  app.get<{ Params: { id: string } }>('/api/v1/mics/:id/eq', async (req, reply) => {
    const ch = manager.getChannel(req.params.id);
    if (!ch) return reply.status(404).send({ error: `Microphone '${req.params.id}' not found` });
    return { id: ch.id, name: ch.name, eq: ch.eq };
  });

  app.post<{ Params: { id: string }; Body: Partial<ChannelEqState> }>('/api/v1/mics/:id/eq', async (req, reply) => {
    try {
      const updated = manager.setChannelEq(req.params.id, req.body || {});
      return { ok: true, id: updated.id, eq: updated.eq };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: message });
    }
  });

  // 13. Update live meter (e.g. from telemetry ingestion)
  app.post<{ Params: { id: string }; Body: { peakDbfs: number } }>('/api/v1/mics/:id/meter', async (req, reply) => {
    if (typeof req.body?.peakDbfs !== 'number') {
      return reply.status(400).send({ error: "Missing numeric field 'peakDbfs'" });
    }
    manager.updateChannelMeter(req.params.id, req.body.peakDbfs);
    return { ok: true, id: req.params.id, peakDbfs: req.body.peakDbfs };
  });

  // 14. Bulk mute group
  app.post<{ Params: { group: string } }>('/api/v1/groups/:group/mute-all', async (req, reply) => {
    const validGroups = ['handheld', 'madonna', 'wired', 'wireless', 'all'];
    if (!validGroups.includes(req.params.group)) {
      return reply.status(400).send({ error: `Invalid group '${req.params.group}'. Valid: ${validGroups.join(', ')}` });
    }
    manager.muteGroup(req.params.group as MicGroup | 'wireless' | 'all');
    return { ok: true, group: req.params.group, action: 'muted_all' };
  });

  // 15. Bulk unmute group
  app.post<{ Params: { group: string } }>('/api/v1/groups/:group/unmute-all', async (req, reply) => {
    const validGroups = ['handheld', 'madonna', 'wired', 'wireless', 'all'];
    if (!validGroups.includes(req.params.group)) {
      return reply.status(400).send({ error: `Invalid group '${req.params.group}'. Valid: ${validGroups.join(', ')}` });
    }
    manager.unmuteGroup(req.params.group as MicGroup | 'wireless' | 'all');
    return { ok: true, group: req.params.group, action: 'unmuted_all' };
  });

  // 16. Recall preset
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

  // 17. Multi-mix management: List all configured mixes and master levels
  app.get('/api/v1/mixes', async () => {
    return {
      mixes: manager.getMixes(),
      masterStates: manager.getMixMasterStates(),
    };
  });

  // 18. Get single mix state and all channel routings for that mix
  app.get<{ Params: { mixId: string } }>('/api/v1/mixes/:mixId', async (req, reply) => {
    try {
      return manager.getMix(req.params.mixId);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(404).send({ error: message });
    }
  });

  // 19. Set mix master volume
  app.post<{ Params: { mixId: string }; Body: { volumePercent: number } }>(
    '/api/v1/mixes/:mixId/master/volume',
    async (req, reply) => {
      if (typeof req.body?.volumePercent !== 'number') {
        return reply.status(400).send({ error: "Missing numeric field 'volumePercent'" });
      }
      try {
        const state = manager.setMixMasterVolume(req.params.mixId, req.body.volumePercent);
        return { ok: true, mixId: req.params.mixId, master: state };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(400).send({ error: message });
      }
    }
  );

  // 20. Set mix master mute
  app.post<{ Params: { mixId: string }; Body: { muted: boolean } }>(
    '/api/v1/mixes/:mixId/master/mute',
    async (req, reply) => {
      if (typeof req.body?.muted !== 'boolean') {
        return reply.status(400).send({ error: "Missing boolean field 'muted'" });
      }
      try {
        const state = manager.setMixMasterMute(req.params.mixId, req.body.muted);
        return { ok: true, mixId: req.params.mixId, master: state };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(400).send({ error: message });
      }
    }
  );

  // 21. Set channel send routing in mix (enabled on/off, volumePercent)
  app.post<{
    Params: { mixId: string; channelId: string };
    Body: { enabled?: boolean; volumePercent?: number };
  }>('/api/v1/mixes/:mixId/channels/:channelId', async (req, reply) => {
    try {
      const send = manager.setMixChannel(req.params.mixId, req.params.channelId, req.body || {});
      return { ok: true, mixId: req.params.mixId, channelId: req.params.channelId, send };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: message });
    }
  });

  // 22. Toggle channel routing in mix
  app.post<{ Params: { mixId: string; channelId: string } }>(
    '/api/v1/mixes/:mixId/channels/:channelId/toggle',
    async (req, reply) => {
      try {
        const send = manager.toggleMixChannel(req.params.mixId, req.params.channelId);
        return { ok: true, mixId: req.params.mixId, channelId: req.params.channelId, send };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(400).send({ error: message });
      }
    }
  );

  // 23. Server-Sent Events (SSE) stream for live updates
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

    const onMixMasterChange = (master: unknown) => {
      reply.raw.write(`event: mix_master_change\ndata: ${JSON.stringify(master)}\n\n`);
    };

    const onMixChannelChange = (change: unknown) => {
      reply.raw.write(`event: mix_channel_change\ndata: ${JSON.stringify(change)}\n\n`);
    };

    manager.on('mic_change', onMicChange);
    manager.on('preset_change', onPresetChange);
    manager.on('bulk_change', onBulkChange);
    manager.on('mix_master_change', onMixMasterChange);
    manager.on('mix_channel_change', onMixChannelChange);

    req.raw.on('close', () => {
      manager.off('mic_change', onMicChange);
      manager.off('preset_change', onPresetChange);
      manager.off('bulk_change', onBulkChange);
      manager.off('mix_master_change', onMixMasterChange);
      manager.off('mix_channel_change', onMixChannelChange);
    });
  });

  return {
    app,
    manager,
    telemetrySender,
    start: async () => {
      telemetrySender?.start();
      await app.listen({ port, host });
      return `http://${host}:${port}`;
    },
    stop: async () => {
      telemetrySender?.stop();
      manager.close();
      await app.close();
    },
  };
}
