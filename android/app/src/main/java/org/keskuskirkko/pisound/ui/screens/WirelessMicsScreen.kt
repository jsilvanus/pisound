package org.keskuskirkko.pisound.ui.screens

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.keskuskirkko.pisound.model.MicChannel
import org.keskuskirkko.pisound.model.RoutingMode
import org.keskuskirkko.pisound.network.ConnectionStatus
import org.keskuskirkko.pisound.ui.theme.*
import org.keskuskirkko.pisound.viewmodel.SoundViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WirelessMicsScreen(viewModel: SoundViewModel) {
    val uiState by viewModel.uiState.collectAsState()
    val connectionStatus by viewModel.client.connectionStatus.collectAsState()
    val lastError by viewModel.client.lastError.collectAsState()

    var showWiredMics by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            text = "PiSound",
                            fontWeight = FontWeight.Bold,
                            fontSize = 20.sp
                        )
                        Spacer(modifier = Modifier.width(12.dp))
                        ConnectionBadge(status = connectionStatus)
                    }
                },
                actions = {
                    IconButton(onClick = { viewModel.toggleSettings() }) {
                        Icon(Icons.Default.Settings, contentDescription = "Asetukset")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface
                )
            )
        }
    ) { paddingValues ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Routing Preset Selector Card (Normal vs SQ-5 Mixer)
            item {
                RoutingSelectorCard(
                    currentMode = uiState.routingMode,
                    onSelectMode = { viewModel.setRoutingMode(it) }
                )
            }

            // Quick Bulk Actions (Mute All / All On)
            item {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Button(
                        onClick = { viewModel.muteAllWireless() },
                        colors = ButtonDefaults.buttonColors(containerColor = MicMutedRed),
                        modifier = Modifier.weight(1f),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Icon(Icons.Default.MicOff, contentDescription = null)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Mykistä kaikki WL", fontWeight = FontWeight.Bold)
                    }

                    OutlinedButton(
                        onClick = { viewModel.unmuteAllWireless() },
                        modifier = Modifier.weight(1f),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Icon(Icons.Default.Mic, contentDescription = null)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Kaikki WL päälle")
                    }
                }
            }

            // Wireless Microphones Section Header
            item {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        Icons.Default.Podcasts,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = "Langattomat mikrofonit",
                        fontSize = 18.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                }
            }

            // List of Wireless Microphones
            val wirelessChannels = uiState.channels.filter { it.isWireless }
            items(wirelessChannels, key = { it.id }) { mic ->
                MicControlCard(
                    mic = mic,
                    onToggle = { viewModel.toggleMic(mic.id) },
                    onSolo = { viewModel.soloWirelessMic(mic.id) },
                    onVolumeChange = { viewModel.setVolume(mic.id, it) }
                )
            }

            // Wired Microphones Toggle & List
            item {
                Spacer(modifier = Modifier.height(8.dp))
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(12.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Default.SettingsVoice, contentDescription = null)
                            Spacer(modifier = Modifier.width(8.dp))
                            Text("Kiinteät mikrofonit (Alttari, Saarnatuoli, Urut)")
                        }
                        IconButton(onClick = { showWiredMics = !showWiredMics }) {
                            Icon(
                                if (showWiredMics) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
                                contentDescription = null
                            )
                        }
                    }
                }
            }

            if (showWiredMics) {
                val wiredChannels = uiState.channels.filter { !it.isWireless }
                items(wiredChannels, key = { it.id }) { mic ->
                    MicControlCard(
                        mic = mic,
                        onToggle = { viewModel.toggleMic(mic.id) },
                        onSolo = null, // Solo mainly for wireless
                        onVolumeChange = { viewModel.setVolume(mic.id, it) }
                    )
                }
            }

            // Bottom Spacing
            item {
                Spacer(modifier = Modifier.height(24.dp))
            }
        }
    }

    if (uiState.showSettings) {
        SettingsDialog(
            host = uiState.targetHost,
            port = uiState.targetPort,
            isSimulated = connectionStatus == ConnectionStatus.SIMULATED,
            onDismiss = { viewModel.toggleSettings() },
            onSave = { host, port, simulated ->
                viewModel.updateConnectionSettings(host, port, simulated)
                viewModel.toggleSettings()
            }
        )
    }
}

@Composable
fun MicControlCard(
    mic: MicChannel,
    onToggle: () -> Unit,
    onSolo: (() -> Unit)?,
    onVolumeChange: (Float) -> Unit
) {
    val buttonColor by animateColorAsState(
        targetValue = if (mic.isOn) MicActiveGreen else Color(0xFF2A2D35),
        label = "micButtonColor"
    )

    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (mic.isOn) Color(0xFF1E2621) else MaterialTheme.colorScheme.surface
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = mic.name,
                        fontSize = 19.sp,
                        fontWeight = FontWeight.Bold,
                        color = Color.White
                    )
                    Text(
                        text = mic.role,
                        fontSize = 13.sp,
                        color = Color.Gray
                    )
                }

                if (onSolo != null) {
                    OutlinedButton(
                        onClick = onSolo,
                        shape = RoundedCornerShape(8.dp),
                        contentPadding = PaddingValues(horizontal = 10.dp, vertical = 6.dp)
                    ) {
                        Text("Vain tämä", fontSize = 12.sp, color = MicSoloAmber)
                    }
                    Spacer(modifier = Modifier.width(12.dp))
                }

                // Big Tactile ON / OFF Button
                Button(
                    onClick = onToggle,
                    colors = ButtonDefaults.buttonColors(containerColor = buttonColor),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier
                        .height(48.dp)
                        .widthIn(min = 120.dp)
                ) {
                    Icon(
                        imageVector = if (mic.isOn) Icons.Default.Mic else Icons.Default.MicOff,
                        contentDescription = null,
                        tint = if (mic.isOn) Color.Black else Color.LightGray
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = if (mic.isOn) "PÄÄLLÄ" else "MYKKÄ",
                        fontWeight = FontWeight.ExtraBold,
                        color = if (mic.isOn) Color.Black else Color.LightGray,
                        fontSize = 14.sp
                    )
                }
            }

            Spacer(modifier = Modifier.height(14.dp))

            // Volume Slider
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    Icons.Default.VolumeDown,
                    contentDescription = null,
                    tint = Color.Gray,
                    modifier = Modifier.size(18.dp)
                )
                Slider(
                    value = mic.volumePercent,
                    onValueChange = onVolumeChange,
                    valueRange = 0f..100f,
                    modifier = Modifier
                        .weight(1f)
                        .padding(horizontal = 8.dp)
                )
                Text(
                    text = "${mic.volumePercent.toInt()}%",
                    fontSize = 12.sp,
                    color = Color.LightGray,
                    modifier = Modifier.width(36.dp)
                )
            }
        }
    }
}

@Composable
fun RoutingSelectorCard(
    currentMode: RoutingMode,
    onSelectMode: (RoutingMode) -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            Text(
                text = "Reititys ja tila (Preset)",
                fontSize = 12.sp,
                fontWeight = FontWeight.Medium,
                color = Color.Gray
            )
            Spacer(modifier = Modifier.height(8.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                RoutingMode.entries.forEach { mode ->
                    val selected = mode == currentMode
                    FilterChip(
                        selected = selected,
                        onClick = { onSelectMode(mode) },
                        label = {
                            Text(
                                mode.displayName,
                                fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal
                            )
                        },
                        leadingIcon = if (selected) {
                            { Icon(Icons.Default.Check, contentDescription = null) }
                        } else null,
                        modifier = Modifier.weight(1f)
                    )
                }
            }
        }
    }
}

@Composable
fun ConnectionBadge(status: ConnectionStatus) {
    val (text, color) = when (status) {
        ConnectionStatus.CONNECTED -> "Yhdistetty (BSS)" to MicActiveGreen
        ConnectionStatus.CONNECTING -> "Yhdistetään..." to MicSoloAmber
        ConnectionStatus.DISCONNECTED -> "Ei yhteyttä" to MicMutedRed
        ConnectionStatus.SIMULATED -> "Simuloitu (Testi)" to Color(0xFF64B5F6)
    }

    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(8.dp))
            .background(color.copy(alpha = 0.2f))
            .border(1.dp, color, RoundedCornerShape(8.dp))
            .padding(horizontal = 8.dp, vertical = 4.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier
                    .size(6.dp)
                    .clip(CircleShape)
                    .background(color)
            )
            Spacer(modifier = Modifier.width(6.dp))
            Text(text = text, color = color, fontSize = 11.sp, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
fun SettingsDialog(
    host: String,
    port: Int,
    isSimulated: Boolean,
    onDismiss: () -> Unit,
    onSave: (host: String, port: Int, simulated: Boolean) -> Unit
) {
    var editedHost by remember { mutableStateOf(host) }
    var editedPort by remember { mutableStateOf(port.toString()) }
    var simMode by remember { mutableStateOf(isSimulated) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("BSS Soundweb London Asetukset") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(
                    value = editedHost,
                    onValueChange = { editedHost = it },
                    label = { Text("DSP IP-osoite (esim. 192.168.1.30)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = editedPort,
                    onValueChange = { editedPort = it },
                    label = { Text("TCP Portti (oletus: 1023)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Checkbox(
                        checked = simMode,
                        onCheckedChange = { simMode = it }
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Simulaatiotila (Ei laitteistoyhteyttä)")
                }
            }
        },
        confirmButton = {
            Button(onClick = {
                val p = editedPort.toIntOrNull() ?: 1023
                onSave(editedHost, p, simMode)
            }) {
                Text("Tallenna")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Peruuta")
            }
        }
    )
}
