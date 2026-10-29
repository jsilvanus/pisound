# pisound Contract & API Specification

`pisound` is the dedicated sound, microphone, and auto-leveling controller service in the Raspberry Pi AV production ecosystem. It interfaces with the **BSS Soundweb London BLU-100** DSP over **Harman HiQnet London Direct Inject (London DI)** TCP port 1023.

---

## 1. Network & Port Allocations

* **Default Service Port**: `3300` (HTTP REST & SSE)
* **Default Host**: `0.0.0.0`
* **BSS Soundweb DSP Target**: `192.168.1.30:1023`
* **Mode**: `simulation` (default) or `production`

---

## 2. Input Profiles & Auto-Leveling (AGC)

Every microphone channel has an assigned **Input Profile**:
* `speech` (Puhe): 75% fader, `agc-pi` active (-22 dBFS target), HPF 80 Hz ON, Mid +2.0 dB at 3.0 kHz.
* `vocal` (Yksinlaulu): 72% fader, `agc-pi` active (-20 dBFS target), HPF 60 Hz ON, Mid +1.5 dB.
* `guitar` (Kitara): 70% fader, AGC off, HPF 50 Hz ON, Low +1.0 dB, Mid -2.0 dB at 800 Hz.
* `piano` (Flyygeli): 70% fader, AGC off, HPF 40 Hz ON.
* `choir` (Kuoro): 68% fader, AGC off, HPF 60 Hz ON.
* `organ` (Urut): 62% fader, AGC off, HPF bypassed (full sub-bass preservation).
* `drums` (Rummut): 55% fader, AGC off, HPF 40 Hz ON, padded for loud peaks.
* `ambient` (Tila/Virsi): 52% fader, AGC off, HPF 80 Hz ON.
* `custom`: User-defined fader, EQ, and AGC values.

### AGC Modes
* `none`: Fixed manual fader.
* `agc-pi`: Intelligent Pi Fader Rider loop (100 ms cadence, noise-gate freeze, configurable attack/decay/hold, feedback guard clamp).
* `agc-blu`: BSS BLU-100 internal DSP hardware AGC block.

---

## 3. REST Endpoints

### Core Endpoints
* `GET /health`: Health status.
* `GET /api/v1/status`: Complete snapshot of all 26 mics, active preset, profiles, and AGC.
* `GET /api/v1/profiles`: List all profile presets.
* `GET /api/v1/mics`: List microphones (with `?group=` or `?wireless=` filter).
* `GET /api/v1/mics/:id`: Single mic state.

### Channel Control
* `POST /api/v1/mics/:id/state`: `{ "on": true | false }` (Mute / Unmute)
* `POST /api/v1/mics/:id/toggle`: Toggle state
* `POST /api/v1/mics/:id/solo`: Solo this mic (mutes other wireless mics)
* `POST /api/v1/mics/:id/volume`: `{ "volumePercent": 0..100 }` (Adjust fader)
* `POST /api/v1/mics/:id/profile`: `{ "profile": "speech" | "vocal" | "guitar" | ... }`
* `GET /api/v1/mics/:id/agc`: Get AGC configuration
* `POST /api/v1/mics/:id/agc`: `{ "mode": "none" | "agc-pi" | "agc-blu", "targetDbfs": -22, "attackTimeMs": 300, ... }`
* `GET /api/v1/mics/:id/eq`: Get EQ state
* `POST /api/v1/mics/:id/eq`: `{ "hpfEnabled": true, "hpfHz": 80, "lowDb": 0, "midHz": 2500, "midDb": 1.5, "highDb": 0 }`
* `POST /api/v1/mics/:id/meter`: `{ "peakDbfs": -24 }` (Update live audio meter)

### Group & Preset Controls
* `POST /api/v1/groups/:group/mute-all`: `handheld`, `madonna`, `wired`, `wireless`, `all`
* `POST /api/v1/groups/:group/unmute-all`: Bulk unmute
* `POST /api/v1/presets/:preset`: `normal`, `mixer`, `open`, `mute`, or ID
* `GET /api/v1/events`: Server-Sent Events (SSE) stream
