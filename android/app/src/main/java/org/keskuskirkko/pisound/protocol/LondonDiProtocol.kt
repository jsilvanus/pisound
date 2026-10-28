package org.keskuskirkko.pisound.protocol

import java.io.ByteArrayOutputStream

/**
 * Harman BSS Soundweb London (London Direct Inject) protocol encoder and decoder.
 * Implements STX/ETX framing, XOR checksumming, byte-escaping, and message builders.
 */
object LondonDiProtocol {
    const val STX: Byte = 0x02
    const val ETX: Byte = 0x03
    const val ACK: Byte = 0x06
    const val NAK: Byte = 0x15
    const val ESC: Byte = 0x1B

    // Message types
    const val MSG_SET: Byte = 0x88.toByte()
    const val MSG_SUBSCRIBE: Byte = 0x89.toByte()
    const val MSG_UNSUBSCRIBE: Byte = 0x8A.toByte()
    const val MSG_RECALL_DEVICE_PRESET: Byte = 0x8B.toByte()
    const val MSG_RECALL_PARAM_PRESET: Byte = 0x8C.toByte()
    const val MSG_SET_PERCENT: Byte = 0x8D.toByte()
    const val MSG_SUBSCRIBE_PERCENT: Byte = 0x8E.toByte()
    const val MSG_UNSUBSCRIBE_PERCENT: Byte = 0x8F.toByte()

    // Virtual devices
    const val VD_LOGIC: Byte = 0x02
    const val VD_AUDIO: Byte = 0x03

    // Default Node ID for BLU-100 in Keskuskirkko
    const val DEFAULT_NODE_ID: Int = 0x0001
    // MR_MIC_MIXER object ID (3 bytes: 0x00, 0x01, 0x07)
    val OBJECT_MIC_MIXER: ByteArray = byteArrayOf(0x00, 0x01, 0x07)

    private val SPECIAL_BYTES = byteArrayOf(STX, ETX, ACK, NAK, ESC)

    /**
     * Frames a raw message body with STX, XOR checksum, byte escaping, and ETX.
     */
    fun encodePacket(rawBody: ByteArray): ByteArray {
        var checksum: Byte = 0
        for (b in rawBody) {
            checksum = (checksum.toInt() xor (b.toInt() and 0xFF)).toByte()
        }

        val out = ByteArrayOutputStream()
        out.write(STX.toInt())

        // Escape body
        for (b in rawBody) {
            writeEscapedByte(out, b)
        }

        // Escape checksum
        writeEscapedByte(out, checksum)

        out.write(ETX.toInt())
        return out.toByteArray()
    }

    private fun writeEscapedByte(out: ByteArrayOutputStream, b: Byte) {
        if (SPECIAL_BYTES.contains(b)) {
            out.write(ESC.toInt())
            out.write(((b.toInt() and 0xFF) + 0x80) and 0xFF)
        } else {
            out.write(b.toInt() and 0xFF)
        }
    }

    /**
     * Unescapes and validates a received packet framed with STX...ETX.
     * Returns the raw unescaped message body, or null if invalid or corrupted checksum.
     */
    fun decodePacket(packet: ByteArray): ByteArray? {
        if (packet.size < 4 || packet.first() != STX || packet.last() != ETX) {
            return null
        }

        val unescaped = ByteArrayOutputStream()
        var i = 1
        val end = packet.size - 1

        while (i < end) {
            val b = packet[i]
            if (b == ESC) {
                if (i + 1 >= end) return null // malformed trailing ESC
                val next = packet[i + 1]
                unescaped.write(((next.toInt() and 0xFF) - 0x80) and 0xFF)
                i += 2
            } else {
                unescaped.write(b.toInt() and 0xFF)
                i++
            }
        }

        val bytes = unescaped.toByteArray()
        if (bytes.isEmpty()) return null

        // Last byte of unescaped payload is the checksum
        val receivedChecksum = bytes.last()
        val body = bytes.copyOfRange(0, bytes.size - 1)

        var computedChecksum: Byte = 0
        for (b in body) {
            computedChecksum = (computedChecksum.toInt() xor (b.toInt() and 0xFF)).toByte()
        }

        if (computedChecksum != receivedChecksum) {
            return null // Checksum mismatch
        }

        return body
    }

    /**
     * Builds a Recall Parameter Preset packet (e.g. Preset 0: WL to Mixer, Preset 1: WL Normal Use)
     */
    fun buildRecallPresetPacket(presetId: Int): ByteArray {
        val body = ByteArrayOutputStream()
        body.write(MSG_RECALL_PARAM_PRESET.toInt())
        // 4-byte big endian preset number
        body.write((presetId shr 24) and 0xFF)
        body.write((presetId shr 16) and 0xFF)
        body.write((presetId shr 8) and 0xFF)
        body.write(presetId and 0xFF)
        return encodePacket(body.toByteArray())
    }

    /**
     * Builds a Set Mute packet for a Mixer channel.
     * In Soundweb London Mixer objects, MUTE parameter for channel N (0-indexed) is parameter ID N.
     * State: 1 = Muted (OFF), 0 = Unmuted (ON).
     */
    fun buildSetMutePacket(
        nodeId: Int = DEFAULT_NODE_ID,
        objectId: ByteArray = OBJECT_MIC_MIXER,
        channelIndex0Based: Int,
        isMuted: Boolean
    ): ByteArray {
        val paramId = channelIndex0Based // Mute parameter ID for channel
        val value = if (isMuted) 1 else 0

        val body = ByteArrayOutputStream()
        body.write(MSG_SET.toInt())
        // 2-byte Node ID
        body.write((nodeId shr 8) and 0xFF)
        body.write(nodeId and 0xFF)
        // 1-byte Virtual Device (Audio)
        body.write(VD_AUDIO.toInt())
        // 3-byte Object ID
        body.write(objectId)
        // 2-byte Parameter ID
        body.write((paramId shr 8) and 0xFF)
        body.write(paramId and 0xFF)
        // 4-byte big-endian value (0 or 1)
        body.write(0)
        body.write(0)
        body.write(0)
        body.write(value)

        return encodePacket(body.toByteArray())
    }

    /**
     * Builds a Set Gain Percent packet for a Mixer channel.
     * Percentage value: 0 to 65536 (or 0 to 10000 depending on scaling; London DI percent format uses 16-bit 0..65536).
     */
    fun buildSetGainPercentPacket(
        nodeId: Int = DEFAULT_NODE_ID,
        objectId: ByteArray = OBJECT_MIC_MIXER,
        channelIndex0Based: Int,
        percent0to100: Float
    ): ByteArray {
        // Gain parameter ID offset in Soundweb Mixer is typically channelIndex + gainOffset
        val paramId = 32 + channelIndex0Based 
        val scaledPercent = ((percent0to100.coerceIn(0f, 100f) / 100f) * 65536f).toInt().coerceIn(0, 65536)

        val body = ByteArrayOutputStream()
        body.write(MSG_SET_PERCENT.toInt())
        body.write((nodeId shr 8) and 0xFF)
        body.write(nodeId and 0xFF)
        body.write(VD_AUDIO.toInt())
        body.write(objectId)
        body.write((paramId shr 8) and 0xFF)
        body.write(paramId and 0xFF)
        // 4-byte big-endian percentage
        body.write((scaledPercent shr 24) and 0xFF)
        body.write((scaledPercent shr 16) and 0xFF)
        body.write((scaledPercent shr 8) and 0xFF)
        body.write(scaledPercent and 0xFF)

        return encodePacket(body.toByteArray())
    }

    /**
     * Builds a Subscribe Percent packet for standing parameter feedback.
     */
    fun buildSubscribePercentPacket(
        nodeId: Int = DEFAULT_NODE_ID,
        objectId: ByteArray = OBJECT_MIC_MIXER,
        paramId: Int,
        rateMs: Int = 100
    ): ByteArray {
        val body = ByteArrayOutputStream()
        body.write(MSG_SUBSCRIBE_PERCENT.toInt())
        body.write((nodeId shr 8) and 0xFF)
        body.write(nodeId and 0xFF)
        body.write(VD_AUDIO.toInt())
        body.write(objectId)
        body.write((paramId shr 8) and 0xFF)
        body.write(paramId and 0xFF)
        // 4-byte update rate (ms)
        body.write((rateMs shr 24) and 0xFF)
        body.write((rateMs shr 16) and 0xFF)
        body.write((rateMs shr 8) and 0xFF)
        body.write(rateMs and 0xFF)

        return encodePacket(body.toByteArray())
    }
}
