package app.melodious.protocol

import app.melodious.protocol.model.DeviceTouchScreen
import app.melodious.protocol.model.DeviceTouchScreens
import app.melodious.protocol.model.HubConfigSnapshot
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** Same cases as the web UI's touchScreenState tests in ir-model.test.mjs. */
class DeviceTouchScreenTest {
    private fun touchMap(identifier: String, mapId: Long, surface: String = "14551427") =
        """{"ButtonMapIdentifier":"$identifier","ButtonMapId-":$mapId,"SurfaceId-":$surface,"RemoteId-":12345678}"""

    private val devices = """{"DevicesWithFeatures":[{"Device":{"Id-":1}},{"Device":{"Id-":2}},{"Device":{"Id-":3}},
        {"Device":{"Id-":4,"AutoDetectedDevice":{"Id":"melodious-ha-4"}}}]}"""

    private fun snapshot(maps: List<String>): HubConfigSnapshot {
        val empty = JsonObject(emptyMap())
        return HubConfigSnapshot(
            revision = "r1",
            rawRoot = empty,
            activityList = empty,
            mapList = Json.parseToJsonElement("""{"ButtonMaps":[${maps.joinToString(",")}]}""").jsonObject,
            functionList = empty,
            deviceList = Json.parseToJsonElement(devices).jsonObject,
            activities = emptyList(),
            devices = emptyList(),
        )
    }

    private val withTouch = snapshot(
        listOf(touchMap("16417Device1", 46597140), touchMap("16417Device2", 52944100), touchMap("16417Activity9", 52944093))
    )

    @Test
    fun `tells Logitech's screens from ones made on the hub`() {
        assertEquals(DeviceTouchScreen.LOGITECH, DeviceTouchScreens.state(withTouch, "1"))
        assertEquals(DeviceTouchScreen.MADE, DeviceTouchScreens.state(withTouch, "2"))
    }

    @Test
    fun `offers a screen when the hub has a Touch and the device has none`() {
        assertEquals(DeviceTouchScreen.NONE, DeviceTouchScreens.state(withTouch, "3"))
    }

    @Test
    fun `leaves Home Assistant devices to the device set`() {
        assertEquals(DeviceTouchScreen.MANAGED, DeviceTouchScreens.state(withTouch, "4"))
    }

    @Test
    fun `offers nothing on a hub without a Touch screen to copy`() {
        assertEquals(DeviceTouchScreen.NO_TOUCH, DeviceTouchScreens.state(snapshot(listOf(touchMap("16414Root", 40550459))), "3"))
        assertEquals(
            DeviceTouchScreen.NO_TOUCH,
            DeviceTouchScreens.state(snapshot(listOf(touchMap("16417Activity9", 52944093, surface = "null"))), "3"),
        )
    }

    @Test
    fun `the request names the device first`() {
        assertEquals("""{"deviceId":"40000001","remove":true}""", DeviceTouchScreens.requestBody("40000001", remove = true).toString())
    }
}
