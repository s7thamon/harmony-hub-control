-- LuaJIT tests for the activity engine wait in payload/activity/codexactivity.lua.
--
-- After a save reloads the engine, the plugin waits for the activity engine
-- before it answers codex_webui. codex_webui gives the whole transaction a
-- fixed time (offline_writer_request) and rolls the save back when no answer
-- comes, though the engine already runs the new config. These tests run
-- waitForActivityEngine against a fake clock and check it always ends in
-- time, then check its limit against the wait in codex_webui.c.
--
-- Same loading pattern as codexactivity-validate-test.lua: stub the hub
-- modules, reach the local function through discover()'s upvalues. No hub
-- is contacted and nothing is written.
--
-- Run from the repo root:
--   luajit tools/touch-validator/codexactivity-barrier-test.lua

local scriptDir = debug.getinfo(1, "S").source:match("^@(.*/)") or "./"
local repoRoot = scriptDir .. "../.."

-- A fake system module: a clock that only blockingSleep moves, and tasks
-- that run when the test says the engine answers.
local clock = 0
local sleepCost = 100 -- ms of clock each blockingSleep(100) takes
local answerAt = nil -- clock time the engine answers; nil = never
local tasks = {}
local function noop() return nil end
local system = {
  uuid = noop,
  sleep = noop,
  isMessageRegistered = function() return true end,
  sendMessage = function() return true end,
  jiffies = function()
    return { tomillis = function() return clock end }
  end,
  addTask = function(_, fn)
    local task = { fn = fn, status = "running" }
    tasks[#tasks + 1] = task
    return task
  end,
  taskStatus = function(task) return task.status end,
  blockingSleep = function()
    clock = clock + sleepCost
    for _, task in ipairs(tasks) do
      if task.status == "running" and answerAt and clock >= answerAt then
        task.fn()
        task.status = "dead"
      end
    end
  end,
}
package.preload["system"] = function() return system end
package.preload["json"] = function()
  return { null = {}, encode = function() return "{}" end, decode = noop }
end
package.preload["log"] = function()
  local logger = { notice = noop, error = noop, warning = noop, debug = noop, info = noop }
  return { logger = function() return logger end }
end
package.preload["tasks.harmonywebservices.core.resourcemanager"] = function() return {} end
package.preload["tasks.harmonywebservices.core.statedigest"] = function()
  return { instance = function() return { configVersion = 0, stateVersion = 0 } end }
end
package.preload["tasks.connectserver.core.utils"] = function() return {} end

package.path = repoRoot .. "/payload/activity/?.lua;" .. package.path
local plugin = require("codexactivity")

local function findUpvalue(fn, name, seen)
  seen = seen or {}
  if type(fn) ~= "function" or seen[fn] then return nil end
  seen[fn] = true
  local i = 1
  while true do
    local upName, value = debug.getupvalue(fn, i)
    if upName == nil then return nil end
    if upName == name then return value end
    if type(value) == "function" then
      local found = findUpvalue(value, name, seen)
      if found ~= nil then return found end
    end
    i = i + 1
  end
end

local function upvalue(fn, name)
  local i = 1
  while true do
    local upName, value = debug.getupvalue(fn, i)
    if upName == nil then return nil end
    if upName == name then return value, i end
    i = i + 1
  end
end

local wait = findUpvalue(plugin.discover, "waitForActivityEngine")
if type(wait) ~= "function" then
  io.stderr:write("could not reach waitForActivityEngine in codexactivity.lua\n")
  os.exit(2)
end
local limitMs = upvalue(wait, "ACTIVITY_ENGINE_BARRIER_MS")

local failures, count = 0, 0
local function check(name, ok, detail)
  count = count + 1
  if ok then
    print("PASS " .. name)
  else
    failures = failures + 1
    print("FAIL " .. name .. (detail and (" (" .. detail .. ")") or ""))
  end
end

-- Each case starts with no barrier left over from the one before.
local function reset(opts)
  clock, tasks = 0, {}
  sleepCost = opts.sleepCost or 100
  answerAt = opts.answerAt
  local _, index = upvalue(wait, "barrierTask")
  debug.setupvalue(wait, index, nil)
end

reset({ answerAt = 3000 })
local ok, err = wait()
check("an engine that answers is waited for", ok == true and clock >= 3000 and clock < 3200,
  "ok=" .. tostring(ok) .. " err=" .. tostring(err) .. " clock=" .. clock)

reset({})
ok, err = wait()
check("an engine that never answers ends the wait at the limit",
  ok == nil and err == "activity engine did not finish rebuilding in time" and
  limitMs ~= nil and clock >= limitMs and clock <= limitMs + 100,
  "err=" .. tostring(err) .. " clock=" .. clock .. " limit=" .. tostring(limitMs))

local before = clock
ok, err = wait()
check("a save while that wait is still parked does not wait again",
  ok == nil and err == "previous activity engine barrier is still pending" and clock == before,
  "err=" .. tostring(err) .. " waited=" .. (clock - before))

reset({ sleepCost = 1000 })
ok, err = wait()
check("an oversleeping blockingSleep still ends by the clock",
  ok == nil and limitMs ~= nil and clock >= limitMs and clock <= limitMs + 1000,
  "clock=" .. clock .. " limit=" .. tostring(limitMs))

-- codex_webui's whole-transaction wait, read from its source, must leave room
-- for the resource writes and the engine reload on top of this wait.
local source = assert(io.open(repoRoot .. "/payload/source/codex_webui.c", "rb")):read("*a")
local body = source:match("static int offline_writer_request%((.-)\nout:")
local attempts = body and tonumber(body:match("attempt < (%d+);"))
local stepMs = body and tonumber(body:match("usleep%((%d+) %* 1000%)"))
local webuiMs = attempts and stepMs and attempts * stepMs
local REQUIRED_MARGIN_MS = 15000
check("the wait leaves " .. REQUIRED_MARGIN_MS / 1000 .. " s inside codex_webui's limit",
  webuiMs and limitMs and limitMs + REQUIRED_MARGIN_MS <= webuiMs,
  "plugin=" .. tostring(limitMs) .. "ms codex_webui=" .. tostring(webuiMs) .. "ms")

print(string.format("%d/%d checks passed", count - failures, count))
os.exit(failures == 0 and 0 or 1)
