# pisound Contract & API Specification

`pisound` is the dedicated sound and microphone controller service in the Raspberry Pi AV production ecosystem. It interfaces with the **BSS Soundweb London BLU-100** DSP over **Harman HiQnet London Direct Inject (London DI)** TCP port 1023.

---

## 1. Network & Port Allocations

* **Default Service Port**: `3300` (HTTP REST & SSE)
* **Default Host**: `0.0.0.0` (binds to all interfaces)
* **BSS Soundweb DSP Target**: `192.168.1.30:1023` (configurable via `PISOUND_SOUNDWEB_HOST` and `PISOUND_SOUNDWEB_PORT`)
* **Mode**: `simulation` (default for offline dev) or `production` (live DSP connection)

---

## 2. Microphone Channel Matrix

| ID | Name | Role | Group | Wireless? | Default Vol |
|---|---|---|---|---|---|
| `kapula1` | Kapula 1 | Liturgi / Pappi | `handheld` | Yes | 75% |
| `kapula2` | Kapula 2 | Kanttori / Avustaja | `handheld` | Yes | 75% |
| `kapula3` | Kapula 3 | Lukija / Tekstinlukija | `handheld` | Yes | 75% |
| `kapula4` | Kapula 4 | Vierailija / Yleisö / Varakapula | `handheld` | Yes | 75% |
| `madonna1` | Madonna 1 | Päämadonna / Saarnaaja | `madonna` | Yes | 80% |
| `madonna2` | Madonna 2 | Liturgi (Headset) | `madonna` | Yes | 80% |
| `madonna3` | Madonna 3 | Kanttori / Solisti | `madonna` | Yes | 80% |
| `madonna4` | Madonna 4 | Avustaja 1 / Esiintyjä | `madonna` | Yes | 80% |
| `madonna5` | Madonna 5 | Avustaja 2 / Esiintyjä | `madonna` | Yes | 80% |
| `madonna6` | Madonna 6 | Esiintyjä / Näytelmä | `madonna` | Yes | 80% |
| `madonna7` | Madonna 7 | Esiintyjä / Näytelmä | `madonna` | Yes | 80% |
| `madonna8` | Madonna 8 | Esiintyjä / Näytelmä | `madonna` | Yes | 80% |
| `madonna9` | Madonna 9 | Esiintyjä / Näytelmä | `madonna` | Yes | 80% |
| `madonna10` | Madonna 10 | Esiintyjä / Varamadonna | `madonna` | Yes | 80% |
| `wired1` | Alttari Vasen | Alttaripöytä (Vasen) | `wired` | No | 70% |
| `wired2` | Alttari Oikea | Alttaripöytä (Oikea) | `wired` | No | 70% |
| `wired3` | Lukupulpetti | Ambo / Lukupulpetti | `wired` | No | 75% |
| `wired4` | Saarnatuoli | Saarnatuoli | `wired` | No | 75% |
| `wired5` | Kuoro Vasen | Kuoromikrofoni Vasen | `wired` | No | 70% |
| `wired6` | Kuoro Oikea | Kuoromikrofoni Oikea | `wired` | No | 70% |
| `wired7` | Urut Positiivi | Positiiviurut | `wired` | No | 65% |
| `wired8` | Urut Pääurut | Pääurut | `wired` | No | 65% |
| `wired9` | Flyygeli | Flyygeli / Piano | `wired` | No | 70% |
| `wired10` | Lattiarasia 1 | Kuorin lattiarasia AV09 | `wired` | No | 70% |
| `wired11` | Lattiarasia 2 | Kuorin lattiarasia AV10 | `wired` | No | 70% |
| `wired12` | Lattiarasia 3 | Parven lattiarasia | `wired` | No | 70% |

---

## 3. Presets

* `normal` (ID `1`): **WL Normaali (Automixer)** — Normal church service mode. Mics mix automatically to sanctuary speakers.
* `mixer` (ID `0`): **WL Mikseriin (SQ-5)** — Routes wireless microphones to the FOH mixing console.
* `open` (ID `3`): **Audio Open** — System startup state (unmutes main outputs).
* `mute` (ID `4`): **Audio Mute** — System shutdown state (mutes main outputs).

---

## 4. REST Endpoints

### `GET /health`
Returns `{ "status": "ok", "service": "pisound" }`.

### `GET /api/v1/status`
Returns full system snapshot:
```json
{
  "service": "pisound",
  "status": "connected",
  "host": "192.168.1.30",
  "port": 1023,
  "mode": "production",
  "currentPreset": { "id": 1, "key": "normal", "name": "WL Normaali (Automixer)" },
  "activeWirelessCount": 1,
  "activeWiredCount": 2,
  "channels": [ ... ],
  "timestamp": "2026-10-29T10:00:00.000Z"
}
```

### `GET /api/v1/mics?group=handheld&wireless=true`
Lists channels, optionally filtered by group or wireless flag.

### `GET /api/v1/mics/:id`
Returns state of a single microphone channel.

### `POST /api/v1/mics/:id/state`
Body: `{ "on": true | false }`
Sets mic state (unmuted or muted).

### `POST /api/v1/mics/:id/toggle`
Toggles between ON and MUTED.

### `POST /api/v1/mics/:id/solo`
Unmutes this microphone and mutes all other wireless microphones.

### `POST /api/v1/mics/:id/volume`
Body: `{ "volumePercent": 0..100 }`
Adjusts gain/volume fader.

### `POST /api/v1/groups/:group/mute-all`
Groups: `handheld`, `madonna`, `wired`, `wireless`, `all`.

### `POST /api/v1/groups/:group/unmute-all`
Bulk unmutes the group.

### `POST /api/v1/presets/:preset`
Preset: `normal`, `mixer`, `open`, `mute`, or numeric ID (`0`, `1`, `3`, `4`).

### `GET /api/v1/events`
Server-Sent Events (SSE) stream pushing events:
* `snapshot`: full initial state
* `mic_change`: updated channel object
* `preset_change`: updated preset object
* `bulk_change`: bulk action summary
