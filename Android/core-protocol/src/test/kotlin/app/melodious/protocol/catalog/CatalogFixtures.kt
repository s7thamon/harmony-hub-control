package app.melodious.protocol.catalog

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import java.io.File

/** Reads the desktop fixture file in place (never copied into this repo). */
fun loadCatalogFixtures(): JsonObject {
    var dir: File? = File(System.getProperty("user.dir")).absoluteFile
    repeat(8) {
        val candidate = File(dir, "desktop/test/fixtures/catalog-fixtures.json")
        if (candidate.isFile) {
            return Json.parseToJsonElement(candidate.readText()) as JsonObject
        }
        dir = dir?.parentFile
    }
    error("desktop/test/fixtures/catalog-fixtures.json not found above ${System.getProperty("user.dir")}")
}

fun fixture(fixtures: JsonObject, name: String): JsonElement = fixtures.getValue(name)
