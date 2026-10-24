-- LuaJIT tests for the offline guards in payload/scripts/netservicestarter.lua
-- that answer the Harmony Touch's own Sync: the time is answered locally, and
-- the hub firmware check is deliberately left to the stock handler (a
-- successful check strands the Touch on a "myharmony.com" screen offline).
--
-- Loads the script with stubbed hub modules (mfgData.hasNetwork = false, so
-- it only "loads" its transport tasks), captures what it registers with the
-- engine, and calls the handlers with the cloud blocker on and off and with
-- a sane and an unset clock. No hub is contacted and nothing is written.
--
-- Run from the repo root:
--   luajit tools/touch-validator/netservicestarter-guards-test.lua

local scriptDir = debug.getinfo(1, "S").source:match("^@(.*/)") or "./"
local repoRoot = scriptDir .. "../.."

local blocker = "1"
local fakeNow = nil
local handlers, nativeCalls = {}, {}

local function noop() return nil end
local function anything()
  return setmetatable({}, { __index = function() return noop end })
end

-- Small JSON encoder (sorted keys) for the responses under test.
local function encode(v)
  local t = type(v)
  if t == "string" then return '"' .. v:gsub('[%c"\\]', function(c) return string.format("\\u%04x", c:byte()) end) .. '"' end
  if t == "number" or t == "boolean" then return tostring(v) end
  if t ~= "table" then return "null" end
  if #v > 0 or next(v) == nil then
    local parts = {}
    for i = 1, #v do parts[i] = encode(v[i]) end
    return "[" .. table.concat(parts, ",") .. "]"
  end
  local keys = {}
  for k in pairs(v) do keys[#keys + 1] = k end
  table.sort(keys)
  local parts = {}
  for _, k in ipairs(keys) do parts[#parts + 1] = encode(k) .. ":" .. encode(v[k]) end
  return "{" .. table.concat(parts, ",") .. "}"
end

local fakeIo = {
  open = function(path)
    if path ~= "/data/codex/cloud_blocker.conf" or blocker == nil then return nil end
    return { read = function() return blocker end, close = noop }
  end,
}

local realOs = os
package.loaded["os"] = setmetatable({
  time = function(...) if fakeNow and select("#", ...) == 0 then return fakeNow end return realOs.time(...) end,
}, { __index = realOs })

package.preload["system"] = function()
  local s = anything()
  rawset(s, "io", fakeIo)
  rawset(s, "getFirmwareVersion", function() return "4.15.600" end)
  return s
end
package.preload["json"] = function() return { encode = encode, decode = noop, null = {} } end
package.preload["log"] = function()
  local logger = { notice = noop, error = noop, warning = noop, debug = noop, info = noop }
  return { logger = function() return logger end }
end
package.preload["tasks.hal.core.hbus"] = function() return { instance = function() return anything() end } end
package.preload["socket.http"] = function() return { request = noop } end
package.preload["socket"] = function() return anything() end
package.preload["tasks.connectserver.core.utils"] = function()
  return {
    createResponse = function(cmd, code, msg, data) return { cmd = cmd, code = code, msg = msg, data = data } end,
    fixHbusData = noop,
  }
end
package.preload["tasks.connectserver.core.engine"] = function()
  return { registerMessage = function(mime, _, fn) handlers[mime] = fn end }
end
package.preload["tasks.mfg.core.mfgdata"] = function() return { hasNetwork = false } end
for _, name in ipairs({
  "tasks.harmonywebservices.apihandler.resource",
  "tasks.setup.apihandler.sync",
  "tasks.harmonywebservices.core.preferencemanager",
  "tasks.harmonywebservices.core.resourcemanager",
  "tasks.harmonywebservices.core.session",
}) do
  package.preload[name] = function() return anything() end
end
package.preload["tasks.harmonywebservices.core.statedigest"] = function()
  return { instance = function() return { tz = "EST5EDT,M3.2.0,M11.1.0" } end }
end
package.preload["tasks.harmonyengine.apihandler.harmonyengine"] = function()
  return { processCmdGetTime = function(cmd) nativeCalls[#nativeCalls + 1] = cmd return { native = cmd } end }
end
package.preload["tasks.setup.apihandler.firmware"] = function()
  return { processCmdDefault = function(cmd) nativeCalls[#nativeCalls + 1] = cmd return { native = cmd } end }
end

local chunk = assert(loadfile(repoRoot .. "/payload/scripts/netservicestarter.lua"))
chunk()

local failures, count = 0, 0
local function check(name, ok, detail)
  count = count + 1
  if ok then
    print("PASS " .. name)
  else
    failures = failures + 1
    print("FAIL " .. name .. (detail and (" (" .. tostring(detail) .. ")") or ""))
  end
end

local getTime = handlers["harmony.engine?gettime"]
check("registers the time guard under the stock name", type(getTime) == "function")
check("leaves every firmware command to the stock handlers",
  handlers["setup.firmware?check"] == nil and handlers["setup.firmware"] == nil and
  handlers["harmony.firmware"] == nil)
if type(getTime) ~= "function" then
  print(string.format("%d/%d checks passed", count - failures, count))
  os.exit(1)
end

-- Blocker on, clock set: the hub answers the time itself.
blocker, fakeNow, nativeCalls = "1", 1792850000, {}
local r = getTime("harmony.engine?getTime", nil, {})
check("blocker on: the time comes from the hub clock",
  r.code == "200" and type(r.data) == "table" and type(r.data.utcTime) == "table" and
  r.data.utcTime.year == 2026 and r.data.tz == "EST5EDT,M3.2.0,M11.1.0" and #nativeCalls == 0,
  encode(r))

-- Blocker on, clock never set: don't hand the Touch a 1970 date.
blocker, fakeNow, nativeCalls = "1", 3600, {}
r = getTime("harmony.engine?getTime", nil, {})
check("blocker on, clock unset: falls back to the stock answer", r.native ~= nil and #nativeCalls == 1)

-- Blocker off: the stock answer.
blocker, fakeNow, nativeCalls = "0", 1792850000, {}
r = getTime("harmony.engine?getTime", nil, {})
check("blocker off: the time is the stock answer", r.native ~= nil and #nativeCalls == 1)

print(string.format("%d/%d checks passed", count - failures, count))
os.exit(failures == 0 and 0 or 1)
