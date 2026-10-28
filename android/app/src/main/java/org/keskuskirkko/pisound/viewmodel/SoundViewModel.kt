package org.keskuskirkko.pisound.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.keskuskirkko.pisound.model.DefaultChannels
import org.keskuskirkko.pisound.model.MicChannel
import org.keskuskirkko.pisound.model.RoutingMode
import org.keskuskirkko.pisound.network.SoundwebClient
import org.keskuskirkko.pisound.protocol.LondonDiProtocol

data class SoundUiState(
    val channels: List<MicChannel> = DefaultChannels.CHANNELS,
    val routingMode: RoutingMode = RoutingMode.NORMAL_AUTOMIXER,
    val masterMute: Boolean = false,
    val showSettings: Boolean = false,
    val targetHost: String = "192.168.1.30",
    val targetPort: Int = 1023
)

class SoundViewModel : ViewModel() {
    private val _uiState = MutableStateFlow(SoundUiState())
    val uiState: StateFlow<SoundUiState> = _uiState.asStateFlow()

    val client = SoundwebClient(viewModelScope)

    init {
        client.host = _uiState.value.targetHost
        client.port = _uiState.value.targetPort
    }

    /**
     * Toggles a microphone between ON (unmuted) and OFF (muted).
     */
    fun toggleMic(channelId: String) {
        val channel = _uiState.value.channels.find { it.id == channelId } ?: return
        setMicOn(channelId, !channel.isOn)
    }

    /**
     * Explicitly sets a mic to ON or OFF.
     */
    fun setMicOn(channelId: String, isOn: Boolean) {
        _uiState.update { state ->
            state.copy(
                channels = state.channels.map {
                    if (it.id == channelId) it.copy(isOn = isOn) else it
                }
            )
        }

        val channel = _uiState.value.channels.find { it.id == channelId } ?: return
        viewModelScope.launch {
            val packet = LondonDiProtocol.buildSetMutePacket(
                channelIndex0Based = channel.channelIndex,
                isMuted = !isOn
            )
            client.sendPacket(packet)
        }
    }

    /**
     * Solo: Turns ON this wireless mic, and immediately MUTES all other wireless mics.
     */
    fun soloWirelessMic(channelId: String) {
        _uiState.update { state ->
            state.copy(
                channels = state.channels.map { ch ->
                    if (ch.isWireless) {
                        ch.copy(isOn = ch.id == channelId)
                    } else {
                        ch
                    }
                }
            )
        }

        viewModelScope.launch {
            for (ch in _uiState.value.channels) {
                if (ch.isWireless) {
                    val packet = LondonDiProtocol.buildSetMutePacket(
                        channelIndex0Based = ch.channelIndex,
                        isMuted = ch.id != channelId
                    )
                    client.sendPacket(packet)
                }
            }
        }
    }

    /**
     * Mutes all wireless mics.
     */
    fun muteAllWireless() {
        _uiState.update { state ->
            state.copy(
                channels = state.channels.map {
                    if (it.isWireless) it.copy(isOn = false) else it
                }
            )
        }

        viewModelScope.launch {
            for (ch in _uiState.value.channels) {
                if (ch.isWireless) {
                    val packet = LondonDiProtocol.buildSetMutePacket(
                        channelIndex0Based = ch.channelIndex,
                        isMuted = true
                    )
                    client.sendPacket(packet)
                }
            }
        }
    }

    /**
     * Unmutes all wireless mics.
     */
    fun unmuteAllWireless() {
        _uiState.update { state ->
            state.copy(
                channels = state.channels.map {
                    if (it.isWireless) it.copy(isOn = true) else it
                }
            )
        }

        viewModelScope.launch {
            for (ch in _uiState.value.channels) {
                if (ch.isWireless) {
                    val packet = LondonDiProtocol.buildSetMutePacket(
                        channelIndex0Based = ch.channelIndex,
                        isMuted = false
                    )
                    client.sendPacket(packet)
                }
            }
        }
    }

    /**
     * Adjusts a channel's volume / gain fader.
     */
    fun setVolume(channelId: String, volumePercent: Float) {
        _uiState.update { state ->
            state.copy(
                channels = state.channels.map {
                    if (it.id == channelId) it.copy(volumePercent = volumePercent) else it
                }
            )
        }

        val channel = _uiState.value.channels.find { it.id == channelId } ?: return
        viewModelScope.launch {
            val packet = LondonDiProtocol.buildSetGainPercentPacket(
                channelIndex0Based = channel.channelIndex,
                percent0to100 = volumePercent
            )
            client.sendPacket(packet)
        }
    }

    /**
     * Changes routing mode: WL Normal Use (automixer) vs WL to Mixer (SQ-5 console).
     */
    fun setRoutingMode(mode: RoutingMode) {
        _uiState.update { it.copy(routingMode = mode) }
        viewModelScope.launch {
            val packet = LondonDiProtocol.buildRecallPresetPacket(mode.presetId)
            client.sendPacket(packet)
        }
    }

    /**
     * Recalls an arbitrary Parameter Preset (e.g. 3: Audio Open, 4: Audio Mute).
     */
    fun recallPreset(presetId: Int) {
        viewModelScope.launch {
            val packet = LondonDiProtocol.buildRecallPresetPacket(presetId)
            client.sendPacket(packet)
        }
    }

    fun toggleSettings() {
        _uiState.update { it.copy(showSettings = !it.showSettings) }
    }

    fun updateConnectionSettings(host: String, port: Int, isSimulated: Boolean) {
        _uiState.update { it.copy(targetHost = host, targetPort = port) }
        client.host = host
        client.port = port
        client.setSimulationMode(isSimulated)
    }
}
