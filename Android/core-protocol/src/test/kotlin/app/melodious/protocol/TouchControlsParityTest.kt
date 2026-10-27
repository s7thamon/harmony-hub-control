package app.melodious.protocol

import app.melodious.protocol.graph.ActivityGraphBuilder
import app.melodious.protocol.graph.TouchScreenGraph
import app.melodious.protocol.model.ActivityWizardDraft
import app.melodious.protocol.model.ButtonMappingSource
import app.melodious.protocol.model.HubDevice
import app.melodious.protocol.model.DeviceCommand
import app.melodious.protocol.model.WizardButtonMapping
import app.melodious.protocol.model.WizardRoleDraft
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.contentOrNull
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.assertFalse
import org.junit.Test

/** P06 #7 / P13 / P11 parity: extra controls, self-long, double-press, fixed slots. */
class TouchControlsParityTest {
    private fun device(id: String, vararg names: String) = HubDevice(
        id = id, name = "Device $id",
        commands = names.map { DeviceCommand(it, 1) },
    )

    @Test
    fun `reconcile keeps non-member extra and never fills defaults when disabled`() {
        val player = device("10", "Play", "Pause")
        val volume = device("20", "VolumeUp")
        val lamp = device("99", "PowerToggle", "BrightnessUp")
        val roles = listOf(
            WizardRoleDraft("PlayMovieActivityRole", "10"),
            WizardRoleDraft("VolumeActivityRole", "20"),
        )
        val buttons = mapOf(
            "Play" to WizardButtonMapping("10", "Play", source = ButtonMappingSource.EXISTING),
            "Red" to WizardButtonMapping("99", "PowerToggle", source = ButtonMappingSource.USER),
        )
        val kept = ActivityGraphBuilder.reconcileWizardButtons(buttons, roles, listOf(player, volume, lamp), fillDefaults = false)
        assertTrue(kept.containsKey("Red"))
        assertEquals(true, kept["Red"]?.extra)
        assertEquals(false, kept["Play"]?.extra)
        assertFalse(kept.containsKey("VolumeUp"))
        val filled = ActivityGraphBuilder.reconcileWizardButtons(buttons, roles, listOf(player, volume, lamp), fillDefaults = true)
        assertTrue(filled.containsKey("VolumeUp"))
    }

    @Test
    fun `isOneShot defaults toggles to self-long`() {
        assertTrue(ActivityGraphBuilder.isOneShotCommand("PowerToggle"))
        assertTrue(ActivityGraphBuilder.isOneShotCommand("mute"))
        assertEquals("oneShot", ActivityGraphBuilder.recommendedPressMode("PlayPause"))
        assertEquals("standard", ActivityGraphBuilder.recommendedPressMode("VolumeUp"))
    }

    @Test
    fun `touch graph keeps fixed slots and malformed rows`() {
        val root = Json.parseToJsonElement(
            """
            {"revision":"r","activityList":{"Activities":[{"Id-":5,"Name":"W","Roles":[]}]},"functionList":{"FunctionMaps":[]},
             "deviceList":{"DevicesWithFeatures":[{"Device":{"Id-":9,"Name":"G"},"Commands":[{"Name":"Home"}]}]},
             "mapList":{"ButtonMaps":[{"ButtonMapId-":1,"ActivityId-":5,"ButtonMapIdentifier":"16417Activity5","SurfaceId-":1,"ButtonMapSurfaceId-":1,"RemoteId-":1,"__type":"ActivityButtonMap","Sequences":[],"Buttons":[
               {"__type":"SoftRemoteButton","FunctionGroupType":0,"ButtonId":100,"TextOnRemote":"Home","MenuItem":{"IndexInMenu":0},"ButtonAction":{"__type":"ButtonCommandAction","DeviceId-":9,"CommandName":"Home"}},
               {"__type":"SoftRemoteButton","FunctionGroupType":0,"ButtonId":101,"TextOnRemote":"Bad","MenuItem":{"IndexInMenu":4},"ButtonAction":{"__type":"ButtonCommandAction","CommandName":"NoDevice"}},
               {"__type":"GestureRemoteButton","ButtonKey":"SwipeUp","ButtonId":102,"ButtonAction":{"__type":"ButtonCommandAction","DeviceId-":9,"CommandName":"Home"}}
             ]}]}}
            """.trimIndent()
        ).jsonObject
        val snapshot = ActivityGraphBuilder.parseConfigSnapshot(root)
        val read = TouchScreenGraph.read(snapshot, "5")
        // Malformed Bad row is not editable, so only Home is editable.
        assertEquals(listOf("Home"), read.buttons.map { it.label })
        val draft = read.copy(buttons = read.buttons + app.melodious.protocol.graph.SoftButtonDraft(
            "Toggle", app.melodious.protocol.graph.SoftButtonAction.Command(app.melodious.protocol.graph.SequenceStep.Command("9", "PowerToggle"))
        ))
        val built = TouchScreenGraph.build(snapshot, draft)
        val maps = built.mapList["ButtonMaps"]!!.jsonArray.map { it.jsonObject }
        val touch = maps.first { it["ButtonMapIdentifier"]!!.jsonPrimitive.content == "16417Activity5" }
        val buttons = touch["Buttons"]!!.jsonArray.map { it.jsonObject }
        // Gap slot 1 goes to the new Toggle (lowest free), Home stays at 0, Bad stays at 4, gesture survives.
        val toggle = buttons.first { it["TextOnRemote"]?.jsonPrimitive?.content == "Toggle" }
        assertEquals(1, toggle["MenuItem"]!!.jsonObject["IndexInMenu"]!!.jsonPrimitive.content.toInt())
        // New one-shot defaults to self-long.
        assertEquals("PowerToggle", (toggle["ButtonLongPressAction"] as JsonObject)["CommandName"]!!.jsonPrimitive.content)
        assertEquals(2, (toggle["ButtonLongPressAction"] as JsonObject)["EventType"]!!.jsonPrimitive.content.toInt())
        assertTrue(buttons.any { it["TextOnRemote"]?.jsonPrimitive?.content == "Bad" })
        assertTrue(buttons.any { it["ButtonKey"]?.jsonPrimitive?.content == "SwipeUp" })
        // Home keeps its slot and id.
        val home = buttons.first { it["TextOnRemote"]?.jsonPrimitive?.content == "Home" }
        assertEquals(0, home["MenuItem"]!!.jsonObject["IndexInMenu"]!!.jsonPrimitive.content.toInt())
        assertEquals("100", home["ButtonId"]!!.jsonPrimitive.content)
    }
}
