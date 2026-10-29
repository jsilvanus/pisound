# pisound

Sound and microphone controller service and CLI for **BSS Soundweb London (HiQnet)**, built for the Raspberry Pi production ecosystem at **Riihimäen Keskuskirkko**.

`pisound` bridges the church's **BSS Soundweb London BLU-100** audio DSP over TCP port 1023 (Harman London Direct Inject protocol) to provide clean REST/SSE APIs and a fast CLI for controlling:
- **Wireless Handheld Mics 1–4** ("Kapula 1–4")
- **Wireless Headset Mics 5–14** ("Madonna 1–10")
- **Sanctuary Wired Mics 1–12+** (Altar, Lectern, Pulpit, Organ, Choir, Floor boxes)
- **Audio Routing Presets** (Sanctuary automixer vs. SQ-5 live mixing console)

---

## 1. Role in the Pi Production Ecosystem

`pisound` is the dedicated audio subsystem companion to `pimatrix` (video routing), `pitube` (YouTube broadcasts), `pilight` (tally lights), `pivoice` (speech telemetry), and `pigateway`:

```
[ picontrol Browser UI ] / [ Mobile Tablets & Phones ]
                      |
                HTTP / SSE (:3100)
                      v
                [ pigateway ]
                      | Proxy (/api/v1/sound/*)
                      v
             +-----------------+
             |     pisound     |  (Port 3300)
             +-----------------+
                      |
           HiQnet London DI (TCP :1023)
                      v
         +-------------------------+
         |   BSS BLU-100 DSP       |
         +-------------------------+
          /           |           \
 [ BLU-BIBs ]    [ BLU-BOB2 ]    [ BLU-DAN ]
  (14 WL +        (Zone Power     (Dante AoIP to
   12 Wired)       Amplifiers)     SQ-5 & PC)
```

---

## 2. Channel Matrix

### Wireless Handhelds 1–4
- `kapula1`: Kapula 1 (Liturgi / Pappi)
- `kapula2`: Kapula 2 (Kanttori / Avustaja)
- `kapula3`: Kapula 3 (Lukija / Tekstinlukija)
- `kapula4`: Kapula 4 (Vierailija / Yleisö / Varakapula)

### Wireless Headsets 5–14 ("Madonna Mics")
- `madonna1`: Madonna 1 (Päämadonna / Saarnaaja)
- `madonna2`: Madonna 2 (Liturgi Headset)
- `madonna3`: Madonna 3 (Kanttori / Solisti)
- `madonna4`–`madonna10`: Madonna 4–10 (Avustajat, näytelmät, esiintyjät)

### Wired Microphones 1–12+
- `wired1` / `wired2`: Alttari Vasen & Oikea
- `wired3`: Lukupulpetti (Ambo)
- `wired4`: Saarnatuoli
- `wired5` / `wired6`: Kuoro Vasen & Oikea
- `wired7` / `wired8`: Urut Positiivi & Pääurut
- `wired9`: Flyygeli / Piano
- `wired10`–`wired12`: Lattiarasiat 1–3 (Kuori AV09, AV10, Parvi)

---

## 3. Installation & Run

Requires **Node.js >= 22**.

```sh
npm install
npm run build
npm test
npm start                # Starts daemon on port 3300 (simulation mode by default)
```

For hardware production on the church LAN:
```sh
PISOUND_MODE=production PISOUND_SOUNDWEB_HOST=192.168.1.30 npm start
```

---

## 4. CLI Usage

Run with `node bin/pisound.mjs` or `npm run cli -- <command>`:

```sh
# View full status table of all handhelds, madonnas, and wired mics
pisound status

# Control individual microphones
pisound mic madonna1 on                  # Turn on (unmute) Madonna 1
pisound mic madonna1 off                 # Mute Madonna 1
pisound mic madonna1 toggle              # Toggle between on and muted
pisound mic madonna1 solo                # Solo Madonna 1 (mutes all other wireless mics!)
pisound mic madonna1 vol 85              # Set volume to 85%

# Fast wireless group controls
pisound wireless mute-all                # Mutes all 14 wireless mics instantly
pisound wireless all-on                  # Unmutes all 14 wireless mics

# Scene & Routing Presets
pisound preset normal                    # WL Normaali (Sanctuary automixer active)
pisound preset mixer                     # WL Mikseriin (Routes wireless mics to SQ-5 console)
pisound preset open                      # Audio Open (Startup state)
pisound preset mute                      # Audio Mute (Shutdown state)
```

---

## 5. REST & SSE API

See full contract in [`CONTRACT.md`](CONTRACT.md).
- `GET /health`: Health status.
- `GET /api/v1/status`: Full system snapshot.
- `GET /api/v1/mics`: List all mic states (with `?group=` or `?wireless=` filter).
- `POST /api/v1/mics/:id/state`: `{ "on": boolean }`
- `POST /api/v1/mics/:id/toggle`: Toggle mic on/off.
- `POST /api/v1/mics/:id/solo`: Solo mic.
- `POST /api/v1/mics/:id/volume`: `{ "volumePercent": 0..100 }`
- `POST /api/v1/groups/:group/mute-all`: Bulk mute (`handheld`, `madonna`, `wireless`, `all`).
- `POST /api/v1/presets/:preset`: Recall preset (`normal`, `mixer`, `open`, `mute`, or ID).
- `GET /api/v1/events`: Server-Sent Events stream for live status updates to browser UIs.
