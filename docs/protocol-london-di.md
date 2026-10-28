# Harman BSS Soundweb London — London Direct Inject (London DI) Protocol Reference

The **London Direct Inject (London DI)** protocol is Harman / BSS Audio's third-party control protocol for Soundweb London (BLU series) DSP devices.

Soundweb London devices (BLU-100, BLU-160, BLU-800, BLU-DAN, etc.) listen continuously for this protocol on **TCP port 1023** and RS-232. No login or authorization handshake is required. Over TCP, ACK/NAK bytes are not required or expected.

---

## 1. Packet Framing

Every London DI packet is delimited by `STX` and `ETX`, with an XOR checksum byte before the `ETX`:

```
+-------+-------------------------+----------+-------+
|  STX  |     Message Body        | Checksum |  ETX  |
| (0x02)| (escaped if necessary)  | (1 byte) | (0x03)|
+-------+-------------------------+----------+-------+
```

### Special / Reserved Bytes
The following 5 bytes are reserved control characters:
- `STX` = `0x02` (Start of transmission)
- `ETX` = `0x03` (End of transmission)
- `ACK` = `0x06` (Acknowledge — serial only)
- `NAK` = `0x15` (Negative acknowledge — serial only)
- `ESC` = `0x1B` (Escape character)

### Checksum Calculation
The checksum is a single-byte XOR of **all bytes in the raw message body** (computed before byte-escaping is applied).

### Byte Escaping (Byte Substitution)
If any byte in the message body *or* the computed checksum byte equals one of the 5 special characters (`0x02`, `0x03`, `0x06`, `0x15`, `0x1B`), it MUST be escaped by replacing it with two bytes:
```
ESC (0x1B) followed by (byte + 0x80)
```
Examples:
- `0x02` -> `0x1B 0x82`
- `0x03` -> `0x1B 0x83`
- `0x06` -> `0x1B 0x86`
- `0x15` -> `0x1B 0x95`
- `0x1B` -> `0x1B 0x9B`

When receiving packets, scan for `0x1B` and subtract `0x80` from the next byte to restore the original value prior to checking the XOR checksum.

---

## 2. Message Types

The first byte of the message body defines the operation:

| Byte | Name | Description |
|---|---|---|
| `0x88` | **SET** | Set parameter value (raw 32-bit signed integer) |
| `0x89` | **SUBSCRIBE** | Subscribe to parameter value updates (responds with SET) |
| `0x8A` | **UNSUBSCRIBE** | Cancel parameter subscription |
| `0x8B` | **RECALL DEVICE PRESET** | Recall a device preset snapshot |
| `0x8C` | **RECALL PARAMETER PRESET** | Recall a parameter preset snapshot by ID |
| `0x8D` | **SET PERCENT** | Set parameter percentage (`0`–`10000` = 0.00%–100.00%, or `0`–`65536`) |
| `0x8E` | **SUBSCRIBE PERCENT** | Subscribe to parameter updates in percentage form |
| `0x8F` | **UNSUBSCRIBE PERCENT** | Cancel percentage subscription |
| `0x91` | **SET STRING** | Set parameter value as ASCII string (up to 32 chars) |

---

## 3. Addressing Hierarchy

Soundweb London uses an 8-byte addressing scheme for objects and parameters:

```
+--------------------+---------------------+--------------------+--------------------+
|  Node ID (2 bytes) | Virtual Dev (1 byte)| Object ID (3 bytes)|  Param ID (2 bytes)|
+--------------------+---------------------+--------------------+--------------------+
```

1. **Node Address (2 bytes)**: Physical or logical address of the Soundweb device on the network (e.g. `0x00 0x01` or `0x44 0xB3`).
2. **Virtual Device (1 byte)**:
   - `0x03`: Audio processing objects
   - `0x02`: Logic objects
3. **Object ID (3 bytes)**: Identifies the processing object within the Audio Architect layout (e.g., Mixer, Gain block, Source Selector, Room Combine). In Keskuskirkko:
   - `MR_MIC_MIXER` = `0x00 0x01 0x07`
   - `PROGVOL` = `0x00 0x01 0x14`
   - `MICVOL` = `0x00 0x01 0x21`
4. **Parameter ID (2 bytes)**:
   - Identifies the specific parameter within the object (e.g., Input Gain, Mute, Fader level, Solo, Pan).

---

## 4. Parameter Value Formats

### Gain Values (Raw vs Percent)
- **Raw range**: `-280,617` (-80 dB, 0%) to `+100,000` (+10 dB, 100%).
- Unity gain (0 dB) corresponds to raw value `0` (approx 73.73%).
- Logarithmic below -10 dB, linear above.
- **Percent format (`0x8D`)**: 0 to 100% scaled as integer or fixed point, where 1% ≈ 1/3 dB.

### Mute Values
- `0`: Unmuted (Sound ON)
- `1`: Muted (Sound OFF)

### Parameter Presets (`0x8C`)
Packet format for preset recall:
```
STX (0x02)
0x8C (Message Type)
0x00 0x00 0x00 <PresetID_1B> (4-byte preset number, Big Endian)
Checksum
ETX (0x03)
```

Presets identified in Keskuskirkko:
- Preset `0`: **WL to Mixer** (Wireless mics routed through mixing console)
- Preset `1`: **WL Normal Use** (Wireless mics routed for normal spoken service)
- Preset `3`: **Audio Open** (Default open state during startup sequence)
- Preset `4`: **Audio Mute** (Master mute during shutdown sequence)
