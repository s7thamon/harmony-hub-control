package app.melodious.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.melodious.protocol.catalog.DEFAULT_CLIENT_ID
import app.melodious.MelodiousUiState
import app.melodious.MelodiousViewModel
import app.melodious.SendStatus
import app.melodious.ui.components.ConfirmDialog
import app.melodious.ui.components.DetailPage
import app.melodious.ui.components.GroupDivider
import app.melodious.ui.components.ListGroup
import app.melodious.ui.components.ListRow
import app.melodious.ui.components.SectionLabel
import app.melodious.ui.components.StatusDot
import app.melodious.ui.theme.MelodiousColors

// ============================================================================
// Settings › Bluetooth keyboard
// ============================================================================

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun BluetoothScreen(state: MelodiousUiState, viewModel: MelodiousViewModel, onBack: () -> Unit) {
    var profile by rememberSaveable { mutableStateOf("btkeyboard") }
    var name by rememberSaveable { mutableStateOf("Melodious Keyboard") }
    val helper = state.btTextHelperStatus

    DetailPage(title = "Bluetooth keyboard", onBack = onBack) { pad ->
        Column(
            Modifier.padding(pad).fillMaxSize().imePadding().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            ListGroup {
                ListRow(
                    title = if (helper.live) "Connected" else "Not connected",
                    subtitle = when {
                        helper.live && helper.target.isNotBlank() -> "Typing goes to ${helper.target}"
                        helper.error.isNotBlank() -> helper.error
                        helper.remedy.isNotBlank() -> helper.remedy
                        else -> "Pair the hub with your TV or streaming box to type from your phone."
                    },
                    leading = { StatusDot(if (helper.live) MelodiousColors.Live else MaterialTheme.colorScheme.outline) },
                )
            }

            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                SectionLabel("Pair a new device")
                Text(
                    "1. Start pairing here.\n2. On your TV, open Bluetooth settings and pick the name below.",
                    fontSize = 14.sp,
                    lineHeight = 21.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(selected = profile == "btkeyboard", onClick = { profile = "btkeyboard" }, label = { Text("Android TV / SHIELD") }, modifier = Modifier.heightIn(min = 40.dp))
                    FilterChip(selected = profile == "btkeyboard-nexus", onClick = { profile = "btkeyboard-nexus" }, label = { Text("Nexus Player") }, modifier = Modifier.heightIn(min = 40.dp))
                }
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text("Name shown on the TV") },
                    singleLine = true,
                    shape = RoundedCornerShape(16.dp),
                    modifier = Modifier.fillMaxWidth(),
                )
                Button(
                    onClick = { viewModel.triggerBtPairing(profile, name.ifBlank { "Melodious Keyboard" }) },
                    modifier = Modifier.fillMaxWidth().height(52.dp),
                ) { Text("Start pairing") }
            }

            if (state.savedBtDevices.isNotEmpty()) {
                Column {
                    SectionLabel("Saved on the hub")
                    ListGroup {
                        state.savedBtDevices.forEachIndexed { i, dev ->
                            ListRow(title = dev.name, subtitle = listOf(dev.bdaddr, dev.type).filter { it.isNotBlank() }.joinToString(" · "))
                            if (i < state.savedBtDevices.lastIndex) GroupDivider()
                        }
                    }
                }
            }
            Spacer(Modifier.height(8.dp))
        }
    }
}

// ============================================================================
// Settings › Advanced
// ============================================================================

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun AdvancedScreen(state: MelodiousUiState, viewModel: MelodiousViewModel, onBack: () -> Unit) {
    var sweepDeviceId by rememberSaveable { mutableStateOf(state.devices.firstOrNull()?.id) }
    var sweepDelay by remember { mutableFloatStateOf(120f) }
    var sshKey by rememberSaveable { mutableStateOf("") }
    var clientId by rememberSaveable { mutableStateOf(state.logitechClientId) }
    var confirmReset by remember { mutableStateOf(false) }
    val sys = state.systemStatus

    DetailPage(title = "Advanced", onBack = onBack) { pad ->
        Column(
            Modifier.padding(pad).fillMaxSize().imePadding().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(24.dp),
        ) {
            Column {
                SectionLabel("Hub status")
                ListGroup {
                    StatusRow("Firmware", sys.firmware)
                    GroupDivider()
                    StatusRow("Up for", sys.uptime)
                    GroupDivider()
                    StatusRow("Memory", sys.memTotal.ifBlank { sys.memory.lineSequence().firstOrNull().orEmpty() })
                    GroupDivider()
                    StatusRow("Sign-in", sys.authMode)
                    GroupDivider()
                    StatusRow("Cloud services", if (sys.cloudBlocked) "Blocked" else "Allowed")
                    GroupDivider()
                    StatusRow("Live updates", if (state.hbusConnected) "On (port 8088)" else "Off · checking every 4 s")
                }
            }

            Column {
                SectionLabel("Recent commands")
                if (state.sendLog.isEmpty()) {
                    Text("Nothing sent yet.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 4.dp))
                } else {
                    ListGroup {
                        state.sendLog.take(15).forEachIndexed { i, entry ->
                            ListRow(
                                title = "${entry.targetName} · ${entry.commandName}",
                                subtitle = entry.error?.let { "${entry.timestamp} · $it" } ?: entry.timestamp,
                                subtitleColor = if (entry.status == SendStatus.FAILED) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                                leading = {
                                    when (entry.status) {
                                        SendStatus.OK -> Icon(Icons.Filled.CheckCircle, contentDescription = "Sent", tint = MelodiousColors.Live, modifier = Modifier.size(20.dp))
                                        SendStatus.FAILED -> Icon(Icons.Outlined.ErrorOutline, contentDescription = "Failed", tint = MaterialTheme.colorScheme.error, modifier = Modifier.size(20.dp))
                                        SendStatus.PENDING -> Icon(Icons.Filled.Schedule, contentDescription = "Sending", tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(20.dp))
                                    }
                                },
                            )
                            if (i < minOf(state.sendLog.size, 15) - 1) GroupDivider()
                        }
                    }
                }
            }

            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                SectionLabel("IR sweep lab")
                Text(
                    "Sends every command a device has, one after another. Useful for finding which codes a device actually responds to.",
                    fontSize = 14.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    state.devices.forEach { d ->
                        FilterChip(selected = d.id == sweepDeviceId, onClick = { sweepDeviceId = d.id }, label = { Text(d.name) }, modifier = Modifier.heightIn(min = 40.dp))
                    }
                }
                Text("Gap between commands: ${sweepDelay.toInt()} ms", fontSize = 14.sp)
                Slider(value = sweepDelay, onValueChange = { sweepDelay = it }, valueRange = 40f..1000f)
                val sweepDevice = state.device(sweepDeviceId)
                if (state.activeBatchRunId != null) {
                    OutlinedButton(onClick = viewModel::cancelBatchSweep, modifier = Modifier.fillMaxWidth().height(52.dp)) {
                        CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                        Spacer(Modifier.size(10.dp))
                        Text("Stop sweep")
                    }
                } else {
                    Button(
                        onClick = { sweepDevice?.let { viewModel.runBatchSweep(it.id, it.commands.map { c -> c.name }, sweepDelay.toInt()) } },
                        enabled = sweepDevice != null && sweepDevice.commands.isNotEmpty() && state.isConnected,
                        modifier = Modifier.fillMaxWidth().height(52.dp),
                    ) { Text("Send all ${sweepDevice?.commands?.size ?: 0} commands") }
                }
                state.batchSweepStatus?.let { Text(it, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }

            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                SectionLabel("SSH recovery")
                Text(
                    "For when the web interface is locked or a hub service is stuck. Needs the hub's root SSH key. The key stays on this screen and is not saved.",
                    fontSize = 14.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                OutlinedTextField(
                    value = sshKey,
                    onValueChange = { sshKey = it },
                    label = { Text("Private key (PEM)") },
                    visualTransformation = PasswordVisualTransformation(),
                    shape = RoundedCornerShape(16.dp),
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                )
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = { viewModel.runSshInspectHub(sshKey) }, enabled = sshKey.isNotBlank() && !state.sshBusy) { Text("Check hub") }
                    OutlinedButton(onClick = { viewModel.runSshRestartServices(sshKey) }, enabled = sshKey.isNotBlank() && !state.sshBusy) { Text("Restart services") }
                    OutlinedButton(onClick = { confirmReset = true }, enabled = sshKey.isNotBlank() && !state.sshBusy) {
                        Text("Clear sign-in lock", color = if (sshKey.isNotBlank()) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                if (state.sshConsoleOutput.isNotBlank()) {
                    SelectionContainer {
                        Text(
                            state.sshConsoleOutput,
                            fontFamily = FontFamily.Monospace,
                            fontSize = 12.sp,
                            lineHeight = 17.sp,
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(16.dp))
                                .background(MaterialTheme.colorScheme.surfaceContainerLowest)
                                .padding(14.dp),
                        )
                    }
                }
            }
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                SectionLabel("Logitech catalog")
                OutlinedTextField(
                    value = clientId,
                    onValueChange = { clientId = it },
                    label = { Text("OAuth client_id") },
                    placeholder = { Text(DEFAULT_CLIENT_ID) },
                    singleLine = true,
                    shape = RoundedCornerShape(16.dp),
                    modifier = Modifier.fillMaxWidth(),
                )
                Text(
                    "Leave empty to use Logitech's public desktop client_id ($DEFAULT_CLIENT_ID).",
                    fontSize = 14.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Button(
                    onClick = { viewModel.saveLogitechClientId(clientId) },
                    modifier = Modifier.fillMaxWidth().height(52.dp),
                ) { Text("Save client_id") }
            }
            Spacer(Modifier.height(16.dp))
        }
    }

    if (confirmReset) {
        ConfirmDialog(
            title = "Clear the sign-in lock?",
            text = "This removes the web interface password from the hub and restarts its services. Anyone on your network will be able to open the hub's web page until you set a new password.",
            confirmLabel = "Clear lock",
            destructive = true,
            onConfirm = { viewModel.runSshEmergencyResetAuth(sshKey) },
            onDismiss = { confirmReset = false },
        )
    }
}

@Composable
private fun StatusRow(label: String, value: String) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 52.dp).padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, fontSize = 15.sp, modifier = Modifier.weight(1f))
        Text(value.ifBlank { "—" }, fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, fontWeight = FontWeight.Normal, maxLines = 2)
    }
}
