package app.melodious.protocol.catalog

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

data class CatalogCommandRow(
    val name: String,
    val keycode: String,
    val raw: String,
    val protocol: String,
)

data class CatalogSkipped(val name: String, val reason: String)

data class CatalogRowsResult(
    val rows: List<CatalogCommandRow>,
    val skipped: List<CatalogSkipped>,
    val protocolsUsed: List<String>,
    val missingProtocols: List<String>,
)

fun catalogRows(pkg: JsonElement?, hubProtocolNames: List<String>): CatalogRowsResult {
    val resources = (pkg as? JsonObject)?.get("resources") as? JsonObject
    val commands = (resources?.get("global_language_commands") as? JsonArray) ?: JsonArray(emptyList())
    val have = hubProtocolNames.toSet()
    val rows = mutableListOf<CatalogCommandRow>()
    val skipped = mutableListOf<CatalogSkipped>()
    val used = sortedSetOf<String>()
    val missing = sortedSetOf<String>()
    for (commandEl in commands) {
        val command = commandEl as? JsonObject
        val name = ((command?.get("Name") as? JsonPrimitive)?.takeIf { it.isString }?.content ?: "").trim()
        if (name.isEmpty()) {
            skipped.add(CatalogSkipped("(unnamed)", "no command name"))
            continue
        }
        val keycode = (command?.get("KeyCode") as? JsonPrimitive)?.takeIf { it.isString }?.content ?: ""
        val raw = (command?.get("Raw") as? JsonPrimitive)?.takeIf { it.isString }?.content ?: ""
        if (keycode.startsWith("G:")) {
            val protocol = keycode.substring(2).substringBefore(":")
            if (protocol.isEmpty()) {
                skipped.add(CatalogSkipped(name, "KeyCode names no protocol"))
                continue
            }
            if (protocol !in have) {
                missing.add(protocol)
                skipped.add(CatalogSkipped(name, "protocol “${protocol}” is not on this hub"))
                continue
            }
            used.add(protocol)
            rows.add(CatalogCommandRow(name, keycode, "", protocol))
        } else if (raw.isNotEmpty()) {
            rows.add(CatalogCommandRow(name, "", raw, ""))
        } else if (keycode.isNotEmpty()) {
            skipped.add(CatalogSkipped(name, "KeyCode is not in Harmony G: form"))
        } else {
            skipped.add(CatalogSkipped(name, "no KeyCode or Raw code"))
        }
    }
    return CatalogRowsResult(
        rows = rows,
        skipped = skipped,
        protocolsUsed = used.sorted(),
        missingProtocols = missing.sorted(),
    )
}

fun hubProtocolNames(protocolList: JsonElement?): List<String> {
    val protocols = (protocolList as? JsonObject)?.get("Protocols") as? JsonArray ?: return emptyList()
    return protocols.mapNotNull { el ->
        val prim = (el as? JsonObject)?.get("Name") as? JsonPrimitive ?: return@mapNotNull null
        val s = if (prim.isString) prim.content else prim.content
        s.takeIf { it.isNotEmpty() }
    }
}

fun describeCatalogRows(result: CatalogRowsResult): String {
    val bits = mutableListOf("${result.rows.size} importable")
    if (result.protocolsUsed.isNotEmpty()) bits.add("protocols: ${result.protocolsUsed.joinToString(", ")}")
    if (result.skipped.isNotEmpty()) bits.add("${result.skipped.size} skipped")
    if (result.missingProtocols.isNotEmpty()) bits.add("missing on hub: ${result.missingProtocols.joinToString(", ")}")
    return bits.joinToString(" · ")
}
