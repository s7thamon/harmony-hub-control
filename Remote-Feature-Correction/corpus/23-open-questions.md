# 23 Open questions

Each question lists what would answer it, and the hardware step (P21) or plan that owns it.

| # | Question | Answer by | Owner |
|---|---|---|---|
| 1 | What exact verb and fields do soft, hard and number-pad presses carry at the hub? | hub log during presses | G1 |
| 2 | Does a swipe arrive as a device-map press with `deviceId` (not `SwipeUp`)? | hub log during a swipe | G1 |
| 3 | Which command does each row of the FGT 0/1006 shared slot run? | press both rows | G2 |
| 4 | What is the real long-press threshold from the Touch? | timed holds | G3 |
| 5 | How many POSTs does a 1 s hold on an HA button produce? | listener count | G4 |
| 6 | Do `pressType`, `sequenceFinished` and error notifies reach the Touch UI? | Touch log during G3 and a failing press | G1/G3 |
| 7 | With the blocker on, does a raw write plus publish reach the Touch? | G5 after P03 Stage 1 | G5 |
| 8 | Does HA input selection work in an activity? | G6 | P16 |
| 9 | Do multi-device HA activity starts lose commands to the 500 ms queue deadline? | G7 | P16 |
| 10 | Does the Touch render gap slots in index order? | G8 | P04 |
| 11 | Are non-member device mappings harmless to `harmony.engine?config` consumers? | G9 | P13 |
| 12 | Can hub-built screens carry a working number pad? | P17 gate | P17 |
| 13 | Does the Touch tolerate an unknown AutomationConfig gateway type, and render a local provider's state? | G10 | P19 |
| 14 | What does the hub do with orphan releases, and with releases dropped during activity start (does IR or IP keep repeating)? | observe IR receiver and log | G1 variant |
| 15 | What is the HAL IR repeat expiry when heartbeats stop? | IR receiver timing | optional |
| 16 | Does the waking key press from deep sleep (`mem`) deliver the key, or only wake? | press while asleep | G1 variant (USB caveat) |
| 17 | Is there more than one LTCP client on the hub's 16717 (broadcasts go to the first only)? | read-only `netstat`-style check, if available | optional |
| 18 | Does the activity-engine program runner apply `programs` for a scene tap? | trace in source, or observe with P19 | P19 |
| 19 | How does the stock `sendPutRequest` for AutomationConfig behave offline (offline queue, `hub_sync_conflict`)? | source plus observation | P19 |
| 20 | What are the current runtime health and Touch behaviour of the two stock gateways? | open Home Control on the Touch (read-only) | optional |
| 21 | Behaviour on other remote models (16414 surfaces, Elite/Companion) | not analysed | out of scope |
