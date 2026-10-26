# P15 Parameterized actions as fixed presets

Status: Proposed · Tier T3 · Area: ha-melodious (no hub change) · Depends on: P10, P11 · Blocks: —

## Problem

The IP device model carries **fixed** strings only: one `{c}` value per command, which the hub
substitutes into the webhook body. Today the integration accepts only one argument form,
`select_source:<src>`, and refuses every other `:argument` (`devices.py:295-302`). Useful
parameterized actions are therefore missing:
- light brightness or colour temperature presets;
- cover positions;
- climate modes and setpoints;
- select options;
- number steps;
- fan percentages and presets;
- vacuum commands.

## Constraints (hub)

- Command values must be ≤ 96 **bytes** and contain no `"`, `\`, `%`, `{`, `}` or control
  characters (`codexactivity.lua:1713-1723`).
- Command names must match `^[%w][%w _.+-]*$`, be ≤ 48 bytes, and be unique ignoring case.
- So: no JSON in values, no free text with those characters, and no runtime values from the
  remote.

## Design

1. **A typed argument grammar** for `{c}` values, validated per domain in HA:

   | Domain | Values |
   |---|---|
   | light | `brightness_pct:<0-100>`, `color_temp_kelvin:<2000-6500>`, `effect:<name>` |
   | cover | `position:<0-100>`, `tilt:<0-100>` |
   | climate | `hvac_mode:<mode>`, `preset_mode:<p>`, `temperature:<n>`, `temperature_step:<±n>` |
   | fan | `percentage:<0-100>`, `preset_mode:<p>`, `oscillate:<on\|off>`, `direction:<forward\|reverse>` |
   | select / input_select | `select_option:<opt>`, `select_next`, `select_previous` |
   | number / input_number | `set_value:<n>`, `increment`, `decrement` |
   | media_player | `volume_set:<0-100>`, `sound_mode:<m>` |
   | vacuum | `start`, `pause`, `stop`, `return_to_base`, `locate`, `clean_spot` |
   | remote | `send_command:<cmd>` (clean ≤ 96 B) |

   - Steps that need current state (`temperature_step`) are computed in HA at call time, where
     state is known.
   - **lock and alarm stay excluded** (security; codes must never be on the hub).
2. **Options UI:** per entity, "Add preset" picks a template and a value. The integration
   creates a hub command named from it (for example `Brightness 40`, `Position 75`) whose
   value is the typed string. Presets become ordinary commands, so they work everywhere
   (screens, keys, sequences) and survive P10's merge rules.
3. **Auto-offered discrete commands per new domain**, without presets:
   - climate `hvac_mode:*` for each supported mode;
   - select options (≤ 32);
   - vacuum basics.
4. **Hold class (P11):** presets are one-shot; `*_step`, `increment` and `decrement` are step.

## Work breakdown

1. `devices.py`:
   - a grammar parser and validator;
   - domain builders for the new domains;
   - preset storage from options.
2. `config_flow.py`: the preset editor.
3. `__init__.py`: `service_call` mapping per grammar entry.
4. README and `docs/HOME_ASSISTANT.md` table.

## Local tests

- Grammar vectors: valid, out of range, forbidden characters, the byte-length boundary.
- Each value maps to the expected `(domain, service, data)`.
- `assert_hub_accepts` for every generated command.

## Hardware gate (approval required, on the owner's HA server)

1. Add one light brightness preset and one cover position preset, if available.
2. Run both from a Touch device screen, and from an activity key (P13).
3. Remove the presets (if unused).

## Risks & rollback

- More commands per device means longer device screens. P04 keeps slots stable as presets are
  added.
- Rollback: the integration release; presets are just commands.

## Definition of done

- Presets can be created, run from the Touch, and survive restarts and power cycles.

## Decisions

—
