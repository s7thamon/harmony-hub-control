# 17 Capability matrices

Legend: ✔ works · ✔h proven on hardware · ~ partial or caveated · ✖ not supported ·
— not applicable.

## 1. Device type × mapping context

| Context | Logitech IR | Melodious IR | BT/HID | Logitech native IP (Roku/Sonos/HEOS) | HA IP device | AutomationConfig device |
|---|---|---|---|---|---|---|
| Activity hard key (Touch) | ✔h | ✔ | ✔h | ✔ | ✔h (the wizard requires membership; P13) | ✖ (Root-only home-control actions; no `16417Root`) |
| Activity on-screen button | ✔h | ✔ | ✔ | ✔ | ✔ (the Touch editor allows any device) | ✖ |
| Gesture | ✔ (needs a device screen with the command) | ~ (needs a hub-built screen) | ✔ | ✔ | ~ (screens exist; untested) | ✖ |
| Device screen, hard + soft | ✔h | ✔h (hub-built) | ✔h | ✔ | ✔h | Home Control UI instead |
| Long press | ✔ | ✔ | ✔ | ✔ | ~ (one POST at ≥ 550 ms; untested) | rocker semantics (Root only) |
| Double press | gesture pad only | gesture pad only | gesture pad only | gesture pad only | gesture pad only | Root rockers |
| Number pad | ✔ (Logitech maps) | ✖ (no generator; P17) | — | — | — | — |
| Sequence step (button-pressed) | ✔ | ✔ | ✔ | ✔ | ✔ (protocols passed) | ✖ |
| Sequence via `holdaction` API | ✔ | ✔ | ✔ | plugin | **✖ (592)** | — |
| Non-power leave action | ✔ | ✔ | ✔ | plugin | **✖ (592)** | — |
| Activity power | ✔h | ✔ | ✔ | ✔ | ✔h | via `programs` |
| Activity input | ✔h | ✔ | — | ✔ | ~ (written, untested) | — |
| Channel role / keyboard role | ✔ (IR digits) | ✔ | keyboard ✔ | plugin | **✖ (592)** | — |
| Hold semantics | IR repeat | IR repeat | HID repeat | plugin | **duplicate POSTs** | absolute values |
| Feedback beyond "accepted" | error notify | error notify | error notify | plugin | HTTP code (hub log only) | `setstate` reply + notify |
| State on the remote | ✖ | ✖ | ✖ | ✖ | ✖ | ✔ (Home Control) |

## 2. HA domains

Kinds of action:
- **D** = discrete;
- **P** = parameterized, possible only as a fixed preset (or a step computed in HA);
- **R** = read-only state.

Classes:
- **impl** = implemented;
- **partial**;
- **arch-missing** = supported by the stock architecture but not built;
- **UI-constr.** = the stock UI can't show it;
- **unsupp.** = genuinely unsupported.

| Domain | D today | P via presets | R | IP class | AutomationConfig / Touch |
|---|---|---|---|---|---|
| media_player | on/off, vol ±, mute, play/pause/playpause/stop/next/prev, source | volume_set, sound_mode | — | **impl**; P arch-missing | no AV type → UI-constr. |
| light | on/off/toggle, brightness ±10 % | brightness_pct, color_temp, effect | — | **impl**; P arch-missing | `lamp` → arch-missing |
| switch, input_boolean | on/off/toggle | — | — | **impl** | `lamp` (plug) → arch-missing |
| fan | on/off/toggle, speed ± | percentage, preset, oscillate, direction | — | **partial** | no type → UI-constr. |
| cover | open/close/stop | position, tilt | — | **partial** | `covering` → arch-missing |
| script | run | fields not expressible | — | **partial** | `extScene`/`programs` → arch-missing |
| scene | activate | — | — | **impl** | `extScene` → arch-missing |
| button, input_button | press | — | — | **impl** (hold risk) | — |
| climate | — | hvac_mode, preset, fixed setpoints; ± in HA | — | **arch-missing** | `thermostat` → arch-missing |
| lock | — | — | — | **unsupp.** (deliberate) | `lock` type; security review |
| select, input_select | — | select_option, next/previous | — | **arch-missing** | UI-constr. |
| number, input_number | — | set_value presets, inc/dec | — | **arch-missing** | UI-constr. |
| vacuum | — | start/pause/stop/return/locate | — | **arch-missing** | UI-constr. |
| remote | — | `send_command` presets | — | **arch-missing** | — |
| alarm_control_panel | — | arm without a code | — | **unsupp.** (codes stay in HA) | hub type, not rendered |
| sensor, binary_sensor | — | — | state | unsupp. on IP | `bsensor`/`asensor`/`nsensor` → arch-missing |
| water_heater | — | — | — | — | `waterheater` → arch-missing |

Value constraints for any preset: ≤ 96 bytes; no `" \ % { }` or control characters; no JSON.

## 3. "Universal": the working definition

- **In scope:**
  - every selected HA entity, plus scripts, scenes and buttons as "action devices", is a
    Harmony device;
  - its discrete actions (and fixed presets) can be placed anywhere a native command can go:
    activity hard keys, on-screen buttons, gestures, device screens, long-press slots,
    sequences, power and inputs;
  - the generated data meets every invariant (§08 §8).
- **Live state:** only where the stock Touch has a state UI (AutomationConfig types), as a
  separate project.
- **Out of scope:**
  - runtime values from the remote;
  - per-press success on the Touch;
  - state on AV device screens;
  - double press outside gestures;
  - claims for remotes other than the Touch.
