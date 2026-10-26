# P21 Hardware validation programme (G1–G10)

Status: Proposed · Tier T5 · Area: hardware · Depends on: per step · Blocks: P16, P18, P19, and the gates of P02–P15

Each step needs the owner's explicit approval **for that step**:
- the assistant runs every command;
- the owner handles the remote and the devices;
- one step at a time, stopping at the first surprise.

Conventions: `plans/00-framework.md` §5.

## Standing preparation (read-only)

1. On the hub: `logread -f`, restarted each step.
2. Touch reachable:
   - over USB Ethernet (`root@192.168.2.1`, Mac interface on 192.168.2.2/24, scratch
     known-hosts `/tmp/melodious-touch-usb/known_hosts`); or
   - over HOT through the hub hal tunnel with a 30000 ms timeout.

   If it is quiet, it is asleep. Wake it; don't reboot.
3. Read the Touch's `/data/loggly/SyncCounter.json` before and after each write step.
4. **USB mode caveat:** the Touch on USB behaves differently from untethered use:
   - it still suspends (its ScreenTimeout is about 29 s);
   - notifications arrive only while it is awake;
   - waking with stale watchdog files has caused self-reboots (which recovered).

   Note the tether state in every result.

## Read-only presses (they send ordinary commands through existing mappings)

| Step | Action (owner) | Observe (assistant) | Expected | Answers |
|---|---|---|---|---|
| **G1** | In an existing activity: one hard key, one on-screen button, one number-pad digit, one swipe | hub log `control.button` lines and fields | hard: `buttonKey`; soft: `indexInMenu` only; number pad: `fire` + `functionGroupType 2`; swipe: a device-map press **with `deviceId`**, not `SwipeUp` | corpus §02 gesture claim; P18 |
| **G2** | On the Logitech Bluetooth device screen, tap both rows that share one slot | which command runs for each | both run the later-in-map button | the slot collision (corpus §04) |
| **G3** | On a hard key with a long-press action: hold 0.4 s, 0.7 s, 1.5 s | short or long result; `pressType` notifies in the Touch log | short / long / long; threshold about 600 ms | corpus §05 |
| **G4** | With the HA listener (`tools/ha_devices.mjs listen`), or HA debug logging, hold an HA on-screen button for 1 s | POST count | about 3 POSTs (press plus holds); none on release | P11 baseline |

## Write steps (one plan each; approve separately)

| Step | Plan | Summary | Stop / rollback |
|---|---|---|---|
| **G5** | P03 | Blocker on: rename one IR command label through the IR form; the Touch pulls and shows it | rename back |
| **G6** | P16 | Test activity with an HA media player and an input: `turn_on`, `select_source:<A>`; end → `turn_off` | delete the activity; revert the set |
| **G7** | P16 | Test activity with 3 HA devices: count arrivals; look for 595 drops | delete the activity |
| **G8** | P04 | Add one command to an HA test device: existing slots don't move; check the order of gaps | revert the set |
| **G9** | P13 | Non-member HA script on a hard key, and a light toggle on an on-screen button: no power at start; each press runs once; `harmony.engine?config` still OK | delete the activity |
| **G10** | P19 | AutomationConfig provider, read-only lamp state | tested restore of AutomationConfig, reboot |

## Recording results

- Post sanitized results on the relevant PR: counts, verbs, field names, pass/fail. No IDs or
  names.
- Update the corpus's open-questions page (`corpus/23-open-questions.md`) and the memory
  notes when a result settles a question.

## Decisions

—
