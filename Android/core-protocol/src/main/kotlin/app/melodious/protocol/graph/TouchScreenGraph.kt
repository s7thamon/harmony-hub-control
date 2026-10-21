package app.melodious.protocol.graph

import app.melodious.protocol.model.HubConfigSnapshot
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive

/** One step of a sequence, or the single action of an on-screen button. */
sealed interface SequenceStep {
    data class Command(val deviceId: String, val command: String, val functionId: Int = 0) : SequenceStep
    data class Delay(val seconds: Double) : SequenceStep
}

/** What an on-screen button does: send one command, or run a named sequence. */
sealed interface SoftButtonAction {
    data class Command(val step: SequenceStep.Command) : SoftButtonAction
    data class RunSequence(val sequenceKey: String) : SoftButtonAction
}

/**
 * An editable on-screen button. [buttonId] and [original] are set for buttons that already exist
 * on the hub, so unknown fields (images, double-press, Logitech-only keys) survive a save.
 */
data class SoftButtonDraft(
    val label: String,
    val action: SoftButtonAction,
    val buttonId: Int? = null,
    val original: JsonObject? = null,
)

/** [key] identifies the sequence inside the editor; existing sequences use their SequenceId. */
data class SequenceDraft(
    val key: String,
    val name: String,
    val steps: List<SequenceStep>,
    val sequenceId: Int? = null,
)

data class TouchScreenDraft(
    val activityId: String,
    val buttons: List<SoftButtonDraft>,
    val sequences: List<SequenceDraft>,
)

/**
 * Reads and rewrites an activity's touch-screen map (`16417Activity<id>`): its labelled on-screen
 * buttons and the sequences they run. Hard-button mappings, number-pad buttons and Touch-only
 * client actions on the same map are carried through untouched.
 */
object TouchScreenGraph {
    private const val NUMPAD_GROUP = 2

    fun identifier(activityId: String) = "16417Activity$activityId"

    private fun maps(snapshot: HubConfigSnapshot): List<JsonObject> =
        (snapshot.mapList["ButtonMaps"] as? JsonArray).orEmpty().mapNotNull { it as? JsonObject }

    private fun JsonObject.str(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull

    private fun isEditable(button: JsonObject): Boolean {
        if (button.str("__type") != "SoftRemoteButton") return false
        if ((button["FunctionGroupType"] as? JsonPrimitive)?.intOrNull == NUMPAD_GROUP) return false
        val type = (button["ButtonAction"] as? JsonObject)?.str("__type")
        return type == "ButtonCommandAction" || type == "ButtonSequenceAction"
    }

    fun read(snapshot: HubConfigSnapshot, activityId: String): TouchScreenDraft {
        val map = maps(snapshot).firstOrNull { it.str("ButtonMapIdentifier") == identifier(activityId) }
            ?: return TouchScreenDraft(activityId, emptyList(), emptyList())

        val sequences = (map["Sequences"] as? JsonArray).orEmpty().mapNotNull { el ->
            val seq = el as? JsonObject ?: return@mapNotNull null
            val id = (seq["SequenceId"] as? JsonPrimitive)?.intOrNull ?: return@mapNotNull null
            SequenceDraft(
                key = id.toString(),
                name = seq.str("Name").orEmpty().ifBlank { "Sequence" },
                steps = parseSteps(seq["Actions"]),
                sequenceId = id,
            )
        }

        val buttons = (map["Buttons"] as? JsonArray).orEmpty()
            .mapNotNull { it as? JsonObject }
            .filter(::isEditable)
            .sortedBy { (it["MenuItem"] as? JsonObject)?.get("IndexInMenu")?.jsonPrimitive?.intOrNull ?: Int.MAX_VALUE }
            .mapNotNull { btn ->
                val action = btn["ButtonAction"] as JsonObject
                val parsed: SoftButtonAction = if (action.str("__type") == "ButtonSequenceAction") {
                    val seqId = (action["SequenceId"] as? JsonPrimitive)?.intOrNull ?: return@mapNotNull null
                    SoftButtonAction.RunSequence(seqId.toString())
                } else {
                    val step = commandStep(action) ?: return@mapNotNull null
                    SoftButtonAction.Command(step)
                }
                SoftButtonDraft(
                    label = btn.str("TextOnRemote").orEmpty().ifBlank { "Button" },
                    action = parsed,
                    buttonId = (btn["ButtonId"] as? JsonPrimitive)?.intOrNull,
                    original = btn,
                )
            }
        return TouchScreenDraft(activityId, buttons, sequences)
    }

    /** Steps in the order the hub runs them (`Order`), as `getSequenceActions` sorts them. */
    fun parseSteps(actions: JsonElement?): List<SequenceStep> =
        (actions as? JsonArray).orEmpty().mapNotNull { it as? JsonObject }
            .sortedBy { (it["Order"] as? JsonPrimitive)?.intOrNull ?: 0 }
            .mapNotNull { action ->
                val type = action.str("__type").orEmpty()
                when {
                    type.contains("ButtonCommandAction") -> commandStep(action)
                    type.contains("ButtonDelayAction") ->
                        (action["Duration"] as? JsonPrimitive)?.doubleOrNull?.let { SequenceStep.Delay(it) }
                    else -> null
                }
            }

    private fun commandStep(action: JsonObject): SequenceStep.Command? {
        val deviceId = action.str("DeviceId-") ?: return null
        val command = action.str("CommandName")?.takeIf { it.isNotBlank() } ?: return null
        return SequenceStep.Command(deviceId, command, (action["FunctionId-"] as? JsonPrimitive)?.intOrNull ?: 0)
    }

    /**
     * Replace (or create) the activity's touch-screen map with [draft]. activityList and
     * functionList are passed through unchanged; only this one map in mapList changes.
     */
    fun build(snapshot: HubConfigSnapshot, draft: TouchScreenDraft): ActivityGraphBuilder.BuiltActivityGraph {
        val alloc = ActivityGraphBuilder.IdAllocator(
            listOf(snapshot.activityList, snapshot.mapList, snapshot.functionList, snapshot.deviceList)
        )
        val all = maps(snapshot)
        val existing = all.firstOrNull { it.str("ButtonMapIdentifier") == identifier(draft.activityId) }
        val activityIdInt = draft.activityId.toInt()

        // Sequence ids are not ButtonMap/Button ids, so keep them unique across every map ourselves.
        val usedSequenceIds = all.flatMap { (it["Sequences"] as? JsonArray).orEmpty() }
            .mapNotNull { ((it as? JsonObject)?.get("SequenceId") as? JsonPrimitive)?.intOrNull }
            .toMutableSet()
        val sequenceIds = draft.sequences.associate { seq ->
            seq.key to (seq.sequenceId ?: generateSequence { alloc.allocateId() }.first { it !in usedSequenceIds }.also { usedSequenceIds += it })
        }
        val sequencesJson = JsonArray(draft.sequences.map { seq ->
            JsonObject(
                mapOf(
                    "SequenceId" to JsonPrimitive(sequenceIds.getValue(seq.key)),
                    "Name" to JsonPrimitive(seq.name.trim().ifBlank { "Sequence" }),
                    "Actions" to JsonArray(seq.steps.mapIndexed { i, step -> stepJson(step, i) }),
                )
            )
        })

        // Keep everything the editor doesn't own, and remember which menu slots those already use.
        val kept = (existing?.get("Buttons") as? JsonArray).orEmpty().mapNotNull { it as? JsonObject }.filterNot(::isEditable)
        val reserved = kept.filter { it.str("__type") == "SoftRemoteButton" && (it["FunctionGroupType"] as? JsonPrimitive)?.intOrNull != NUMPAD_GROUP }
            .mapNotNull { (it["MenuItem"] as? JsonObject)?.get("IndexInMenu")?.jsonPrimitive?.intOrNull }
            .toSet()
        val slots = generateSequence(0) { it + 1 }.filter { it !in reserved }.iterator()

        val editorButtons = draft.buttons.mapNotNull { button ->
            val actionJson = when (val action = button.action) {
                is SoftButtonAction.Command -> stepJson(action.step, 0)
                is SoftButtonAction.RunSequence -> {
                    val seqId = sequenceIds[action.sequenceKey] ?: return@mapNotNull null
                    JsonObject(mapOf("__type" to JsonPrimitive("ButtonSequenceAction"), "SequenceId" to JsonPrimitive(seqId), "Order" to JsonPrimitive(0)))
                }
            }
            val base = button.original ?: blankSoftButton()
            JsonObject(
                base.toMutableMap().apply {
                    put("ButtonId", JsonPrimitive(button.buttonId ?: alloc.allocateId()))
                    put("TextOnRemote", JsonPrimitive(button.label.trim().ifBlank { "Button" }))
                    put("ButtonAction", actionJson)
                    put("MenuItem", JsonObject(mapOf("IndexInMenu" to JsonPrimitive(slots.next()), "MenuName" to JsonPrimitive("Activity.${draft.activityId}"))))
                }
            )
        }

        val now = "/Date(${System.currentTimeMillis()}+0000)/"
        val newMap = JsonObject(
            (existing ?: blankMap(all, activityIdInt, alloc)).toMutableMap().apply {
                put("Buttons", JsonArray(kept + editorButtons))
                put("Sequences", sequencesJson)
                put("DateModified", JsonPrimitive(now))
            }
        )
        val merged = if (existing != null) all.map { if (it === existing) newMap else it } else all + newMap

        val activityName = (snapshot.activityList["Activities"] as? JsonArray).orEmpty()
            .mapNotNull { it as? JsonObject }
            .firstOrNull { it.str("Id-") == draft.activityId }?.str("Name").orEmpty()
        return ActivityGraphBuilder.BuiltActivityGraph(
            activityId = draft.activityId,
            name = activityName,
            activityList = snapshot.activityList,
            mapList = JsonObject(snapshot.mapList.toMutableMap().apply { put("ButtonMaps", JsonArray(merged)) }),
            functionList = snapshot.functionList,
        )
    }

    private fun stepJson(step: SequenceStep, order: Int): JsonObject = when (step) {
        is SequenceStep.Command -> JsonObject(
            mapOf(
                "__type" to JsonPrimitive("ButtonCommandAction"),
                "DeviceId-" to JsonPrimitive(step.deviceId.toLongOrNull() ?: 0),
                "CommandName" to JsonPrimitive(step.command),
                "FunctionId-" to JsonPrimitive(step.functionId),
                "Order" to JsonPrimitive(order),
                "EventType" to JsonPrimitive(0),
                "Id" to JsonPrimitive(0),
            )
        )
        is SequenceStep.Delay -> JsonObject(
            mapOf(
                "__type" to JsonPrimitive("ButtonDelayAction"),
                "Duration" to JsonPrimitive(step.seconds),
                "Order" to JsonPrimitive(order),
            )
        )
    }

    /** Field set copied from soft buttons the Logitech cloud wrote on a live hub. */
    private fun blankSoftButton() = JsonObject(
        mapOf(
            "__type" to JsonPrimitive("SoftRemoteButton"),
            "FunctionGroupType" to JsonPrimitive(0),
            "ButtonImageKey" to JsonNull,
            "ImageId-" to JsonPrimitive(0),
            "ButtonState" to JsonPrimitive(1),
            "ButtonImagePath" to JsonNull,
            "ButtonDoublePressAction" to JsonNull,
            "ButtonLongPressAction" to JsonNull,
        )
    )

    /** A new 16417 map reuses the touch surface and remote ids every other activity's map carries. */
    private fun blankMap(all: List<JsonObject>, activityId: Int, alloc: ActivityGraphBuilder.IdAllocator): JsonObject {
        val sibling = all.firstOrNull { it.str("ButtonMapIdentifier")?.startsWith("16417Activity") == true }
            ?: all.firstOrNull { it.str("ButtonMapIdentifier")?.startsWith("16417") == true }
        require(sibling != null) { "This hub has no touch-screen surface to add on-screen buttons to." }
        return JsonObject(
            mapOf(
                "ButtonMapId-" to JsonPrimitive(alloc.allocateMapId()),
                "ActivityId-" to JsonPrimitive(activityId),
                "ButtonMapSurfaceId-" to (sibling["ButtonMapSurfaceId-"] ?: JsonNull),
                "__type" to JsonPrimitive("ActivityButtonMap"),
                "RemoteId-" to (sibling["RemoteId-"] ?: JsonNull),
                "ButtonMapIdentifier" to JsonPrimitive(identifier(activityId.toString())),
                "DateModified" to JsonNull,
                "Sequences" to JsonArray(emptyList()),
                "SurfaceId-" to (sibling["SurfaceId-"] ?: JsonNull),
                "Buttons" to JsonArray(emptyList()),
            )
        )
    }
}
