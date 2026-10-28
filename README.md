# pisound

Modern sound control application and protocol interface for **BSS Soundweb London (HiQnet)** and church audio systems, designed for mobile Android devices and the Raspberry Pi production ecosystem.

Developed for **Riihimäen Keskuskirkko** to replace deprecated legacy tools and provide responsive wireless control of microphone faders, mutes, zone volumes, and audio scene presets.

---

## 1. Dante vs. HiQnet: What Are We Controlling?

A common point of confusion in networked AV installations is the distinction between **Dante** and **HiQnet**:

| Protocol / System | What It Does | Role in Church | Controllable via `pisound`? |
|---|---|---|---|
| **Dante** (Audinate) | **Audio Transport (AoIP)**: Transmits uncompressed digital audio streams over standard IP networks between devices. | Connects BSS BLU-DAN to Allen & Heath SQ-5, PC streaming interface, and subwoofer. | **No for live mixing** (Dante routes audio cables digitally, but does not have mic faders/mutes). |
| **HiQnet / London DI** (Harman / BSS) | **Audio Control & DSP**: Controls faders, mutes, automixers, EQ, matrix gains, and scene presets over **TCP port 1023**. | Controls the **BSS Soundweb London BLU-100** DSP engine in the rack. | **YES — Primary Target!** Direct control of all church mic levels, mutes, and presets without credentials. |
| **SQ Control Protocol** (Allen & Heath) | **Mixing Console Control**: MIDI over TCP on port 51325 for Allen & Heath digital consoles. | Controls the FOH SQ-5 console during concerts and band performances. | **Optional secondary target** for concert/musical modes. |

> In short: **Dante carries the sound, but HiQnet controls the volume!** `pisound` targets the **HiQnet London Direct Inject** protocol on TCP port 1023 to control the BSS Soundweb London DSP.

---

## 2. Background & The Problem at Keskuskirkko

1. **Current Reality**: Day-to-day sound mixing during church services has required an operator on a Windows PC running Harman's bulky *HiQnet Audio Architect* desktop software.
2. **Abandoned Mobile Tools**: Harman previously offered *HiQnet Motion Control* for iOS/Android, but the app is deprecated, unstable on modern Android versions, and difficult to customize.
3. **Disconnected Touch Panels**: The legacy AMX touch panel in the church only supported 4 static presets and had its mic fader channels disconnected from the DSP in software.
4. **The Goal of `pisound`**: A lightweight, fast, modern Android app (and optional Pi gateway bridge) allowing a pastor, cantor, sacristan, or technician to walk the church with a tablet/phone and:
   - Adjust microphone levels on the fly.
   - Instantly mute / unmute open microphones with high-visibility color tallies.
   - Recall service scenes (e.g. *WL Normal / Jumalanpalvelus*, *WL to Mixer / Konsertti*, *Hiljainen*, *Audio Mute*).
   - View live VU meters pushed directly from the DSP.

---

## 3. Architecture & Data Flow

```
+-------------------------------------------------------------+
|                     Android Tablet / Phone                  |
|          pisound App (Kotlin + Jetpack Compose)             |
+-------------------------------------------------------------+
                              |
                     Wi-Fi (Ubiquiti AP)
                              |
      +-----------------------+-----------------------+
      | (Option A: Direct TCP)                        | (Option B: Pi Bridge)
      v                                               v
+-------------------------------+             +-------------------------------+
|     BSS Soundweb London       |             |           pigateway           |
|         BLU-100 DSP           |             |    (Raspberry Pi 5 Server)    |
|      (TCP port 1023)          |             |  HTTP REST / SSE on :3100     |
+-------------------------------+             +-------------------------------+
      |                                               |
  Controls Faders & Mutes                             | Translates to London DI
      |                                               v
+-------------------------------+             +-------------------------------+
|  BLU-BIB (Inputs: Mics)       |             |     BSS Soundweb London       |
|  BLU-BOB (Outputs: Amps)      |             |         BLU-100 DSP           |
|  BLU-DAN (Dante to SQ-5 & PC) |             +-------------------------------+
+-------------------------------+
```

### Protocol Overview (London DI)
- **Transport**: Raw TCP socket on port `1023` to the BLU-100's IP address (`192.168.1.x`).
- **Framing**: `0x02` (STX) ... `[Message Body]` ... `[XOR Checksum]` ... `0x03` (ETX).
- **Escaped Bytes**: Special bytes (`0x02`, `0x03`, `0x06`, `0x15`, `0x1B`) escaped with `0x1B` + `(byte + 0x80)`.
- **Subscriptions**: The app sends `0x8E` (Subscribe Percent) on startup; the DSP streams live feedback updates whenever any fader or meter moves.
- See detailed protocol docs in [`docs/protocol-london-di.md`](docs/protocol-london-di.md).

---

## 4. Channels & Functions

Based on the confirmed rack configuration and NetLinx archives:

### Microphone Channels
- **Kapula 1**: Wireless Handheld Mic 1
- **Kapula 2**: Wireless Handheld Mic 2
- **Kapula 3**: Wireless Handheld Mic 3
- **Solmio**: Wireless Lavalier / Lapel Mic
- **Mic 1**: Altar / Lectern Mic
- **Mic 2**: Pulpit (Saarnatuoli) Mic
- **Mic 3**: Organ / Choir / Spare Mic

### Parameter Presets
- `Preset 0`: **WL to Mixer** (Directs wireless microphones to the FOH mixing console)
- `Preset 1`: **WL Normal Use** (Automixer active, routes directly to sanctuary speaker zones)
- `Preset 3`: **Audio Open** (Sanctuary audio output active)
- `Preset 4`: **Audio Mute** (Master audio output muted)

---

## 5. Repository Structure

```
pisound/
├── docs/
│   ├── protocol-london-di.md         # Full Harman HiQnet London DI packet spec
│   └── keskuskirkko-audio-system.md  # Keskuskirkko audio hardware & rack signal chain
├── android/                          # Android application (Kotlin / Jetpack Compose)
│   ├── app/
│   │   ├── src/main/java/org/keskuskirkko/pisound/
│   │   │   ├── protocol/             # London DI framing, encoder/decoder, socket client
│   │   │   ├── model/                # Channel strip, fader state, preset models
│   │   │   ├── viewmodel/            # SoundViewModel with reactive state
│   │   │   └── ui/                   # Jetpack Compose UI (Faders, Mute buttons, Preset grid)
├── server/                           # Optional Node/TypeScript service for PiGateway / Web UI
├── .gitignore
└── README.md
```

---

## 6. Next Steps & Implementation Roadmap

1. [x] Research & document audio protocols (Dante AoIP vs. HiQnet London DI).
2. [x] Document Keskuskirkko rack hardware and wire protocol specifications.
3. [ ] Build London DI protocol parser and socket client engine in Kotlin / Java.
4. [ ] Build Android UI with Jetpack Compose (Faders, Mutes, Presets, Settings).
5. [ ] Add mock BSS BLU-100 emulator server for local offline testing and CI.
6. [ ] (Optional) Integrate London DI endpoints into `pigateway` and `picontrol` web UI.
