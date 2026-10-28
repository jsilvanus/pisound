package org.keskuskirkko.pisound.model

enum class RoutingMode(val displayName: String, val presetId: Int) {
    NORMAL_AUTOMIXER("WL Normaali (Automixer)", 1),
    ROUTED_TO_MIXER("WL Mikseriin (SQ-5)", 0)
}

data class MicChannel(
    val id: String,
    val name: String,
    val role: String,
    val channelIndex: Int,
    val isWireless: Boolean = true,
    val isOn: Boolean = false, // true = Unmuted / Active; false = Muted
    val volumePercent: Float = 75f, // ~unity gain
    val signalPresent: Boolean = false
) {
    val isMuted: Boolean get() = !isOn
}

object DefaultChannels {
    val CHANNELS = listOf(
        MicChannel(
            id = "kapula1",
            name = "Kapula 1",
            role = "Liturgi / Pappi (Langaton)",
            channelIndex = 0,
            isWireless = true,
            isOn = true,
            volumePercent = 75f
        ),
        MicChannel(
            id = "kapula2",
            name = "Kapula 2",
            role = "Kanttori / Avustaja (Langaton)",
            channelIndex = 1,
            isWireless = true,
            isOn = false,
            volumePercent = 75f
        ),
        MicChannel(
            id = "kapula3",
            name = "Kapula 3",
            role = "Lukija / Vierailija (Langaton)",
            channelIndex = 2,
            isWireless = true,
            isOn = false,
            volumePercent = 75f
        ),
        MicChannel(
            id = "solmio",
            name = "Solmio",
            role = "Saarnaaja (Lavalier)",
            channelIndex = 3,
            isWireless = true,
            isOn = false,
            volumePercent = 80f
        ),
        MicChannel(
            id = "mic1",
            name = "Mic 1 (Alttari)",
            role = "Alttarimikrofoni (Kiinteä)",
            channelIndex = 4,
            isWireless = false,
            isOn = true,
            volumePercent = 70f
        ),
        MicChannel(
            id = "mic2",
            name = "Mic 2 (Saarnatuoli)",
            role = "Saarnatuoli / Lukupulpetti",
            channelIndex = 5,
            isWireless = false,
            isOn = false,
            volumePercent = 75f
        ),
        MicChannel(
            id = "mic3",
            name = "Mic 3 (Urut / Kuoro)",
            role = "Urkuparvi / Kuoro",
            channelIndex = 6,
            isWireless = false,
            isOn = false,
            volumePercent = 65f
        )
    )
}
