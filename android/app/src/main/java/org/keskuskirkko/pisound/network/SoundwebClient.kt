package org.keskuskirkko.pisound.network

import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.keskuskirkko.pisound.protocol.LondonDiProtocol
import java.io.InputStream
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.atomic.AtomicBoolean

enum class ConnectionStatus {
    DISCONNECTED,
    CONNECTING,
    CONNECTED,
    SIMULATED
}

class SoundwebClient(
    private val scope: CoroutineScope
) {
    private var socket: Socket? = null
    private var outputStream: OutputStream? = null
    private var inputStream: InputStream? = null

    private val _connectionStatus = MutableStateFlow(ConnectionStatus.SIMULATED)
    val connectionStatus: StateFlow<ConnectionStatus> = _connectionStatus.asStateFlow()

    private val _lastError = MutableStateFlow<String?>(null)
    val lastError: StateFlow<String?> = _lastError.asStateFlow()

    private val isRunning = AtomicBoolean(false)
    private var readJob: Job? = null

    var host: String = "192.168.1.30" // BLU unit IP
    var port: Int = 1023
    var isSimulated: Boolean = true

    fun setSimulationMode(simulated: Boolean) {
        isSimulated = simulated
        if (simulated) {
            disconnect()
            _connectionStatus.value = ConnectionStatus.SIMULATED
        } else {
            connect()
        }
    }

    fun connect() {
        if (isSimulated) {
            _connectionStatus.value = ConnectionStatus.SIMULATED
            return
        }

        disconnect()
        _connectionStatus.value = ConnectionStatus.CONNECTING

        scope.launch(Dispatchers.IO) {
            try {
                val s = Socket()
                s.connect(InetSocketAddress(host, port), 4000)
                socket = s
                outputStream = s.getOutputStream()
                inputStream = s.getInputStream()
                isRunning.set(true)
                _connectionStatus.value = ConnectionStatus.CONNECTED
                _lastError.value = null

                startReaderLoop()
            } catch (e: Exception) {
                _lastError.value = "Yhteysvirhe: ${e.message}"
                _connectionStatus.value = ConnectionStatus.DISCONNECTED
            }
        }
    }

    fun disconnect() {
        isRunning.set(false)
        readJob?.cancel()
        readJob = null
        try {
            outputStream?.close()
            inputStream?.close()
            socket?.close()
        } catch (_: Exception) {}
        socket = null
        outputStream = null
        inputStream = null
        if (!isSimulated) {
            _connectionStatus.value = ConnectionStatus.DISCONNECTED
        }
    }

    suspend fun sendPacket(packet: ByteArray) = withContext(Dispatchers.IO) {
        if (isSimulated) {
            // Simulated: log or echo
            return@withContext
        }
        try {
            val out = outputStream
            if (out != null && socket?.isConnected == true) {
                out.write(packet)
                out.flush()
            } else {
                _lastError.value = "Ei yhteyttä laitteeseen"
            }
        } catch (e: Exception) {
            _lastError.value = "Lähetysvirhe: ${e.message}"
            disconnect()
        }
    }

    private fun startReaderLoop() {
        readJob = scope.launch(Dispatchers.IO) {
            val buffer = ByteArray(2048)
            val stream = inputStream ?: return@launch
            while (isRunning.get() && isActive) {
                try {
                    val count = stream.read(buffer)
                    if (count < 0) {
                        disconnect()
                        break
                    }
                    val data = buffer.copyOfRange(0, count)
                    handleIncomingBytes(data)
                } catch (e: Exception) {
                    if (isRunning.get()) {
                        disconnect()
                    }
                    break
                }
            }
        }
    }

    private fun handleIncomingBytes(bytes: ByteArray) {
        // Optional: Parse London DI incoming stream packets for feedback
        val decoded = LondonDiProtocol.decodePacket(bytes)
        if (decoded != null) {
            // Feed to listeners
        }
    }
}
