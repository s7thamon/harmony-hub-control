package app.melodious.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Router
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.melodious.MelodiousUiState
import app.melodious.MelodiousViewModel
import app.melodious.HubConnection
import app.melodious.ui.components.DetailPage
import app.melodious.ui.components.GroupDivider
import app.melodious.ui.components.IconTile
import app.melodious.ui.components.ListGroup
import app.melodious.ui.components.ListRow
import app.melodious.ui.components.SectionLabel
import app.melodious.ui.components.StatusDot
import app.melodious.ui.theme.MelodiousColors

/** Full-screen first-run / lost-connection page. */
@Composable
fun ConnectGate(state: MelodiousUiState, viewModel: MelodiousViewModel) {
    Column(Modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState())) {
        Column(Modifier.padding(start = 20.dp, end = 20.dp, top = 32.dp, bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            IconTile(Icons.Filled.Router, size = 56, container = MaterialTheme.colorScheme.primaryContainer, tint = MaterialTheme.colorScheme.onPrimaryContainer)
            Spacer(Modifier.height(8.dp))
            Text(
                when (state.connection) {
                    HubConnection.SEARCHING -> "Looking for your hub…"
                    HubConnection.CONNECTING -> "Connecting…"
                    HubConnection.UNREACHABLE -> "Can't reach your hub"
                    HubConnection.NOT_FOUND -> "No hub found"
                    HubConnection.CONNECTED -> "Connected"
                },
                fontSize = 28.sp,
                fontWeight = FontWeight.Medium,
            )
            Text(
                when (state.connection) {
                    HubConnection.UNREACHABLE -> "Make sure your phone is on the same Wi-Fi as the hub and the hub is powered on."
                    HubConnection.NOT_FOUND -> "Your network may block discovery. Enter the hub's IP address below."
                    else -> "Make sure your phone is on the same Wi-Fi as the hub."
                },
                fontSize = 15.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        HubConnectContent(state, viewModel, showRetry = true)
    }
}

/** Settings › Hub. */
@Composable
fun HubSettingsScreen(state: MelodiousUiState, viewModel: MelodiousViewModel, onBack: () -> Unit) {
    DetailPage(title = "Hub", onBack = onBack) { pad ->
        Column(Modifier.padding(pad).fillMaxSize().imePadding().verticalScroll(rememberScrollState())) {
            HubConnectContent(state, viewModel, showRetry = false)
        }
    }
}

@Composable
private fun HubConnectContent(state: MelodiousUiState, viewModel: MelodiousViewModel, showRetry: Boolean) {
    val saved = state.activeEndpoint
    var host by rememberSaveable { mutableStateOf(saved?.host.orEmpty()) }
    var port by rememberSaveable { mutableStateOf((saved?.webUiPort ?: 8080).toString()) }
    var showSignIn by rememberSaveable { mutableStateOf(saved?.basicAuthHeader != null) }
    var user by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    val busy = state.connection == HubConnection.CONNECTING || state.connection == HubConnection.SEARCHING

    Column(Modifier.padding(horizontal = 16.dp, vertical = 16.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
        if (state.connection == HubConnection.UNREACHABLE && state.connectionError != null) {
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(MelodiousColors.PowerContainer).padding(16.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Icon(Icons.Outlined.ErrorOutline, contentDescription = null, tint = MelodiousColors.OnPowerContainer)
                Text(
                    "${saved?.host ?: "Hub"}: ${state.connectionError}",
                    color = MelodiousColors.OnPowerContainer,
                    fontSize = 14.sp,
                    modifier = Modifier.weight(1f),
                )
            }
        }
        if (showRetry && saved != null && !busy) {
            Button(onClick = viewModel::retryConnection, modifier = Modifier.fillMaxWidth().height(52.dp)) {
                Text("Try again", fontSize = 15.sp)
            }
        }

        Column {
            Row(verticalAlignment = Alignment.CenterVertically) {
                SectionLabel("Hubs on this network", Modifier.weight(1f))
                if (state.isScanningHubs) {
                    CircularProgressIndicator(Modifier.size(18.dp).padding(end = 4.dp), strokeWidth = 2.dp)
                    Spacer(Modifier.width(8.dp))
                } else {
                    TextButton(onClick = viewModel::scanForHubs) { Text("Search again") }
                }
            }
            if (state.discoveredHubs.isEmpty()) {
                Text(
                    if (state.isScanningHubs) "Searching…" else "None found.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(start = 4.dp),
                )
            } else {
                ListGroup {
                    state.discoveredHubs.forEachIndexed { i, hub ->
                        val isActive = state.isConnected && hub.host == saved?.host
                        ListRow(
                            title = hub.name.ifBlank { "Hub" },
                            subtitle = hub.host + if (hub.webUiPort != 8080) ":${hub.webUiPort}" else "",
                            leading = { IconTile(Icons.Filled.Router, size = 40) },
                            trailing = {
                                if (isActive) {
                                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                        StatusDot(MelodiousColors.Live)
                                        Text("Connected", fontSize = 13.sp, color = MelodiousColors.Live)
                                    }
                                }
                            },
                            enabled = !busy,
                            onClick = { viewModel.connectToHub(hub) },
                        )
                        if (i < state.discoveredHubs.lastIndex) GroupDivider()
                    }
                }
            }
        }

        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            SectionLabel("Enter address")
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(
                    value = host,
                    onValueChange = { host = it.trim() },
                    label = { Text("Hub IP address") },
                    placeholder = { Text("192.168.1.20") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                    shape = RoundedCornerShape(16.dp),
                    modifier = Modifier.weight(1f),
                )
                OutlinedTextField(
                    value = port,
                    onValueChange = { port = it.filter(Char::isDigit).take(5) },
                    label = { Text("Port") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    shape = RoundedCornerShape(16.dp),
                    modifier = Modifier.width(100.dp),
                )
            }
            if (showSignIn) {
                OutlinedTextField(
                    value = user,
                    onValueChange = { user = it },
                    label = { Text("Username") },
                    singleLine = true,
                    shape = RoundedCornerShape(16.dp),
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it },
                    label = { Text("Password") },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    shape = RoundedCornerShape(16.dp),
                    modifier = Modifier.fillMaxWidth(),
                )
            } else {
                TextButton(onClick = { showSignIn = true }) { Text("My hub needs a sign-in") }
            }
            OutlinedButton(
                onClick = { viewModel.connectManualHub(host, port.toIntOrNull() ?: 8080, user, password) },
                enabled = host.isNotBlank() && !busy,
                modifier = Modifier.fillMaxWidth().height(52.dp),
            ) {
                if (state.connection == HubConnection.CONNECTING) {
                    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                    Spacer(Modifier.width(10.dp))
                }
                Text("Connect")
            }
        }
        Spacer(Modifier.height(16.dp))
    }
}
