# Keskuskirkko Audio System Architecture & Hardware

This document outlines the sound equipment, signal routing, network topology, and control planes at Riihimäen Keskuskirkko, referenced from the `keskuskirkko` repository and installer diagrams.

---

## 1. Dante vs. HiQnet: The Core Distinction

When controlling sound in this environment, it is critical to distinguish between **audio transport** and **audio control**:

```
+----------------------------------------------------------------------------------+
|                               CONTROL PLANE                                      |
|                                                                                  |
|  [Android App (pisound)] / [Engineer Laptop] / [AMX Master]                      |
|                           |                                                      |
|                 HiQnet London DI (TCP :1023)                                     |
|                           v                                                      |
|                   [ BSS BLU-100 DSP ]                                            |
|              (Faders, Mutes, Presets, EQs)                                       |
+----------------------------------------------------------------------------------+
                                   |
                          Controls Signal Flow
                                   |
+----------------------------------v-----------------------------------------------+
|                            AUDIO TRANSPORT (AoIP)                                |
|                                                                                  |
|   [ JTS Wireless Mics ] ---> [ BSS BLU-BIBs ] (Analog In)                        |
|                                   |                                              |
|                                BLU Link (Cat5e, 48ch)                            |
|                                   |                                              |
|                           [ BSS BLU-100 DSP ]                                    |
|                                   |                                              |
|                                BLU Link                                          |
|                                   |                                              |
|                          [ BSS BLU-DAN Bridge ]                                  |
|                             |               |                                    |
|                    Dante Primary       Dante Secondary                           |
|                             |               |                                    |
|         +-------------------+---------------+-------------------+                |
|         |                   |                                   |                |
|         v                   v                                   v                |
|  [ A&H SQ-5 Mixer ]   [ PC Streaming In/Out ]        [ Fohhn Subwoofer Amp ]     |
|  (Dante Option Card)  (Dante Virtual Soundcard/USB)   (DLI-130ANA Net In)        |
+----------------------------------------------------------------------------------+
```

### Dante (Audinate)
- **Role**: High-bandwidth, ultra-low latency digital audio networking over standard Ethernet (Layer 3 IP / UDP).
- **Control**: Dante Controller manages route subscriptions (connecting transmitter audio channels to receiver audio channels).
- **Does NOT**: Control mic faders, gains, mutes, or church zone levels during a service.

### HiQnet (Harman / BSS Audio)
- **Role**: Device control and monitoring protocol for Harman hardware (BSS Soundweb London, Crown, JBL).
- **Control Protocol**: **London Direct Inject (London DI)** over **TCP port 1023**.
- **DOES**: Set faders, toggle mutes, query VU meters, recall room presets, configure automixers, and adjust zone gains.

---

## 2. Church Audio Hardware Inventory

| Device | Model | IP / Interface | Function |
|---|---|---|---|
| **BSS BLU-100** | Soundweb London DSP | `192.168.1.x` (TCP 1023, RS-232) | 12x8 Open-Architecture DSP. **The main processing and control target.** |
| **BSS BLU-DAN** | Dante / BLU-Link Bridge | Ethernet + Dante Pri/Sec | Bridges 64x64 digital audio channels between Dante AoIP and BSS BLU-Link bus. |
| **BSS BLU-BOB2** | Break-Out Box | `192.168.1.30` | 8-channel analog line output breakout feeding power amplifiers. |
| **BSS BLU-BIB (#1, #2, #3)** | Break-In Boxes | BLU-Link | 8-channel analog mic/line input expanders (3 units = 24 inputs total). |
| **JTS R-4** | Wireless Mic Receivers | XLR out -> BLU-BIB | 3x 4-channel wireless receivers (handhelds, lavaliers, headsets). |
| **Allen & Heath SQ-5** | Digital Console | Dante + LAN (`51325`) | Standalone FOH mixer (used for concerts and complex musical services). |
| **Fohhn DLI-130ANA** | Subwoofer DSP/Amp | Net In (CAT6A) | Subwoofer reinforcement amplifier. |
| **WPI-1000** | Induction Loop Amp | Analog in, LAN out | Assistive listening for hearing aids + Internet radio feed. |
| **16-Channel Amp** | Zone Power Amp | Multi-zone analog in | Drives sanctuary speaker zones (Cantor, under gallery, side aisles, organ). |

---

## 3. Discovered Mic Channels & Control Strips

From the original AMX NetLinx source code and Touch Panel design files in `keskuskirkko`:

### Primary Microphone Strips
1. **Kapula 1** (Handheld Wireless Mic 1)
2. **Kapula 2** (Handheld Wireless Mic 2)
3. **Kapula 3** (Handheld Wireless Mic 3)
4. **Solmio** (Lavalier / Lapel Mic)
5. **Mic 1** (Altar / Lectern Mic)
6. **Mic 2** (Pulpit / Saarnatuoli Mic)
7. **Mic 3** (Organ / Choir / Spare Mic)

### Known Presets
- **Preset 0: WL to Mixer** — Routes wireless mic audio through the SQ-5 / live mixing console.
- **Preset 1: WL Normal Use** — Automatic automixer routing directly through BLU-100 for normal spoken services without a dedicated audio engineer.
- **Preset 3: Audio Open** — Startup state, unmuting main outputs.
- **Preset 4: Audio Mute** — Shutdown state, muting system outputs.
