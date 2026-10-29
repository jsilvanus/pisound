# picontrol: pisound Integration Plan

This document outlines how `pisound` is integrated into the browser-based control surface (`picontrol`).

---

## 1. Data Flow & Network Architecture

```
[ picontrol Browser UI ]
          |
    HTTP / SSE (:3100)
          v
    [ pigateway ]
          | Proxy (/api/v1/sound/*)
          v
     [ pisound ] (:3300)
          | London DI (TCP :1023)
          v
 [ BSS BLU-100 DSP ]
```

Calls route through `pigateway` (or directly to `pisound:3300` in LAN/development).

---

## 2. Planned UI Elements in `picontrol`

### A. Dedicated "Ääni / Mikrofonit" (Sound / Microphones) View
Accessible from the main navigation header in `picontrol`:

1. **Routing Preset Header**:
   - Chips: `[ WL Normaali (Automixer) ]` and `[ WL Mikseriin (SQ-5) ]`
   - Active preset highlighted in green.
   - Quick mute button: `[ Mykistä kaikki langattomat ]` (Red).

2. **Handheld Mics Strip (Kapulat 1–4)**:
   - 4 channel cards:
     - Big `[ ON / MYKKÄ ]` toggle button.
     - `[ Solo ]` button.
     - Compact volume slider with dB / % readout.

3. **Madonna / Headset Mics Grid (Madonnat 5–14)**:
   - 10 channel cards:
     - High-visibility status indicator.
     - Fast `[ Solo ]` button for sermon or individual speeches.
     - Volume fader.

4. **Wired Microphones Collapsible Section (1–12)**:
   - Altar, Lectern, Pulpit, Organ, Choir, Floor boxes.
