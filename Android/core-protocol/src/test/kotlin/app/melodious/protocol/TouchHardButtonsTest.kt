package app.melodious.protocol

import app.melodious.protocol.graph.ActivityGraphBuilder
import app.melodious.protocol.model.ActivityWizardDraft
import app.melodious.protocol.model.HubConfigSnapshot
import app.melodious.protocol.model.WizardButtonMapping
import app.melodious.protocol.model.WizardRoleDraft
import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Same cases as the web wizard's "Harmony Touch hard buttons" tests, on the same Logitech fixture. */
class TouchHardButtonsTest {
    private val fixture: JsonObject = run {
        var dir: File? = File(System.getProperty("user.dir")).absoluteFile
        repeat(8) {
            val candidate = File(dir, "tools/webui-sim/fixtures/activity-config.json")
            if (candidate.isFile) return@run Json.parseToJsonElement(candidate.readText()) as JsonObject
            dir = dir?.parentFile
        }
        error("tools/webui-sim/fixtures/activity-config.json not found above ${System.getProperty("user.dir")}")
    }

    private fun snapshot(root: JsonObject = fixture): HubConfigSnapshot = ActivityGraphBuilder.parseConfigSnapshot(root)

    private fun JsonObject.text(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull
    private fun JsonObject.buttons(): List<JsonObject> = (this["Buttons"] as? JsonArray).orEmpty().map { it.jsonObject }
    private fun maps(root: JsonObject): List<JsonObject> = root["ButtonMaps"]!!.jsonArray.map { it.jsonObject }
    private fun touchMap(mapList: JsonObject, id: String) = maps(mapList).firstOrNull { it.text("ButtonMapIdentifier") == "16417Activity$id" }
    private fun hardKeys(map: JsonObject) = map.buttons().filter { it.text("__type") == "HardRemoteButton" }.map { it.text("ButtonKey") }
    private fun notHard(map: JsonObject) = map.buttons().filter { it.text("__type") != "HardRemoteButton" }

    /** The wizard's draft for an existing activity: its 16414 map's command buttons, as the app reads them. */
    private fun draftFor(id: String): ActivityWizardDraft {
        val activity = fixture["activityList"]!!.jsonObject["Activities"]!!.jsonArray.map { it.jsonObject }
            .first { it.text("Id-") == id }
        val wizard = maps(fixture["mapList"]!!.jsonObject).first { it.text("ButtonMapIdentifier") == "16414Activity$id" }
        val buttons = wizard.buttons().mapNotNull { button ->
            val press = button["ButtonAction"] as? JsonObject ?: return@mapNotNull null
            val command = press.text("CommandName") ?: return@mapNotNull null
            val hold = button["ButtonLongPressAction"] as? JsonObject
            button.text("ButtonKey")!! to WizardButtonMapping(
                deviceId = press.text("DeviceId-")!!,
                commandName = command,
                functionId = press.text("FunctionId-")?.toIntOrNull() ?: 0,
                holdDeviceId = hold?.text("DeviceId-"),
                holdCommandName = hold?.text("CommandName"),
                holdFunctionId = hold?.text("FunctionId-")?.toIntOrNull() ?: 0,
            )
        }.toMap()
        val roles = activity["Roles"]!!.jsonArray.map { it.jsonObject }
            .map { WizardRoleDraft(roleType = it.text("__type")!!, deviceId = it.text("DeviceId-")!!) }
        return ActivityWizardDraft(editActivityId = id, name = activity.text("Name")!!, roles = roles, buttons = buttons)
    }

    @Test
    fun `keys are named the way the Touch does`() {
        assertEquals("DVR", ActivityGraphBuilder.touchHardKey("Dvr"))
        assertEquals("VolumeUp", ActivityGraphBuilder.touchHardKey("VolumeUp"))
        assertEquals("", ActivityGraphBuilder.touchHardKey("Number5"))
    }

    @Test
    fun `a new activity gets a Touch map with the hard buttons the Touch has`() {
        val draft = ActivityWizardDraft(
            name = "Touch keys",
            roles = listOf(WizardRoleDraft(roleType = "VolumeActivityRole", deviceId = "74521691")),
            buttons = mapOf(
                "VolumeUp" to WizardButtonMapping("74521691", "VolumeUp", holdDeviceId = "74521691", holdCommandName = "VolumeUp"),
                "Dvr" to WizardButtonMapping("74521691", "Guide"),
                "Number1" to WizardButtonMapping("74521691", "1"),
            ),
        )
        val built = ActivityGraphBuilder.buildActivityGraph(snapshot(), draft)
        val touch = touchMap(built.mapList, built.activityId)
        assertNotNull("the Touch map is created", touch)
        assertEquals(listOf("DVR", "VolumeUp"), hardKeys(touch!!).sortedBy { it })
        assertEquals(touch.text("SurfaceId-"), "14551427")
        val wizard = maps(built.mapList).first { it.text("ButtonMapIdentifier") == "16414Activity${built.activityId}" }
            .buttons().first { it.text("ButtonKey") == "VolumeUp" }
        val volume = touch.buttons().first { it.text("ButtonKey") == "VolumeUp" }
        assertEquals(wizard["ButtonAction"], volume["ButtonAction"])
        assertEquals(wizard["ButtonLongPressAction"], volume["ButtonLongPressAction"])
        assertNotEquals(wizard["ButtonId"], volume["ButtonId"])
        val ids = maps(built.mapList).flatMap { it.buttons() }.map { it.text("ButtonId") }
        assertEquals("button ids are unique", ids.size, ids.toSet().size)
    }

    @Test
    fun `an unchanged save leaves a Logitech Touch map as it was`() {
        for (id in listOf("48113644", "48113650", "49051068", "51908793")) {
            val built = ActivityGraphBuilder.buildActivityGraph(snapshot(), draftFor(id))
            assertEquals(id, touchMap(fixture["mapList"]!!.jsonObject, id), touchMap(built.mapList, id))
        }
    }

    @Test
    fun `a changed key reaches the Touch and its other buttons stay put`() {
        // Music's 16414 map has Stop; its Touch map was set up without it.
        val id = "49051068"
        val before = touchMap(fixture["mapList"]!!.jsonObject, id)!!
        val draft = draftFor(id)
        val removed = hardKeys(before).first { it != "VolumeUp" && draft.buttons.containsKey(it) }!!
        val edited = draft.copy(
            buttons = draft.buttons - removed + ("VolumeUp" to WizardButtonMapping("78760839", "ChannelUp")),
        )
        val after = touchMap(ActivityGraphBuilder.buildActivityGraph(snapshot(), edited).mapList, id)!!
        val volume = { map: JsonObject -> map.buttons().first { it.text("ButtonKey") == "VolumeUp" } }
        assertEquals("ChannelUp", (volume(after)["ButtonAction"] as JsonObject).text("CommandName"))
        assertEquals(volume(before)["ButtonId"], volume(after)["ButtonId"])
        val order = { map: JsonObject -> map.buttons().filter { it.text("ButtonKey") != removed }.map { it["ButtonId"] } }
        assertEquals(order(before), order(after))
        assertFalse(removed in hardKeys(after))
        assertFalse("Stop stays off the Touch", "Stop" in hardKeys(after))
        assertEquals(notHard(before), notHard(after))
    }

    @Test
    fun `a hub without a Touch gets no Touch map`() {
        val mapList = JsonObject(
            mapOf("ButtonMaps" to JsonArray(maps(fixture["mapList"]!!.jsonObject).filterNot { it.text("ButtonMapIdentifier")!!.startsWith("16417") }))
        )
        val root = JsonObject(fixture + ("mapList" to mapList))
        val draft = ActivityWizardDraft(name = "No Touch", buttons = mapOf("VolumeUp" to WizardButtonMapping("74521691", "VolumeUp")))
        val built = ActivityGraphBuilder.buildActivityGraph(snapshot(root), draft)
        assertNull(touchMap(built.mapList, built.activityId))
        assertTrue(maps(built.mapList).any { it.text("ButtonMapIdentifier") == "16414Activity${built.activityId}" })
    }
}
