-- LuaJIT tests for the hub MapList validator in payload/activity/codexactivity.lua.
--
-- The plugin's validateGraph is a local function. The harness loads the
-- plugin with stubbed hub modules, then walks the upvalues of its public
-- discover() entry point (discover -> start -> workerLoop -> processRequest
-- -> commitActivityResources -> validateGraph) to reach it. No hub is
-- contacted and nothing is written.
--
-- Run from the repo root:
--   luajit tools/touch-validator/codexactivity-validate-test.lua \
--     tools/webui-sim/fixtures/touch-maplist.json
-- Exit code 0 means every fixture case validated as expected.

local fixturePath = arg and arg[1]
if not fixturePath then
  io.stderr:write("usage: luajit codexactivity-validate-test.lua <fixtures.json>\n")
  os.exit(2)
end

local scriptDir = debug.getinfo(1, "S").source:match("^@(.*/)") or "./"
local repoRoot = scriptDir .. "../.."

-- Minimal JSON decoder (test code only). null decodes to the same sentinel
-- the json stub below hands to the plugin, so its json.null checks work.
local NULL = {}
local function decodeJson(text)
  local pos = 1
  local parseValue
  local function skipWs()
    while pos <= #text and text:sub(pos, pos):match("%s") do pos = pos + 1 end
  end
  local function parseString()
    pos = pos + 1
    local out = {}
    while pos <= #text do
      local c = text:sub(pos, pos)
      if c == '"' then
        pos = pos + 1
        return table.concat(out)
      elseif c == "\\" then
        local esc = text:sub(pos + 1, pos + 1)
        if esc == "u" then
          local code = tonumber(text:sub(pos + 2, pos + 5), 16) or 0
          out[#out + 1] = code < 128 and string.char(code) or "?"
          pos = pos + 6
        else
          local map = { n = "\n", t = "\t", r = "\r", b = "\b", f = "\f" }
          out[#out + 1] = map[esc] or esc
          pos = pos + 2
        end
      else
        out[#out + 1] = c
        pos = pos + 1
      end
    end
    error("unterminated string")
  end
  local function parseNumber()
    local s = text:match("^%-?%d+%.?%d*[eE]?[%-+]?%d*", pos)
    pos = pos + #s
    return tonumber(s)
  end
  function parseValue()
    skipWs()
    local c = text:sub(pos, pos)
    if c == "{" then
      pos = pos + 1
      local obj = {}
      skipWs()
      if text:sub(pos, pos) == "}" then pos = pos + 1 return obj end
      while true do
        skipWs()
        local key = parseString()
        skipWs()
        pos = pos + 1
        obj[key] = parseValue()
        skipWs()
        if text:sub(pos, pos) == "}" then pos = pos + 1 return obj end
        pos = pos + 1
      end
    elseif c == "[" then
      pos = pos + 1
      local arr = {}
      skipWs()
      if text:sub(pos, pos) == "]" then pos = pos + 1 return arr end
      while true do
        arr[#arr + 1] = parseValue()
        skipWs()
        if text:sub(pos, pos) == "]" then pos = pos + 1 return arr end
        pos = pos + 1
      end
    elseif c == '"' then
      return parseString()
    elseif text:sub(pos, pos + 3) == "true" then
      pos = pos + 4
      return true
    elseif text:sub(pos, pos + 4) == "false" then
      pos = pos + 5
      return false
    elseif text:sub(pos, pos + 3) == "null" then
      pos = pos + 4
      return NULL
    end
    return parseNumber()
  end
  return parseValue()
end

-- Stub the hub modules the plugin requires at load time.
local function noop() return nil end
package.preload["system"] = function()
  return { uuid = noop, sleep = noop, addTask = noop, isMessageRegistered = noop }
end
package.preload["json"] = function()
  return { null = NULL, encode = function() return "{}" end, decode = decodeJson }
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

local validateGraph = findUpvalue(plugin.discover, "validateGraph")
if type(validateGraph) ~= "function" then
  io.stderr:write("could not reach validateGraph in codexactivity.lua\n")
  os.exit(2)
end

local f = io.open(fixturePath, "rb")
if not f then
  io.stderr:write("cannot read fixtures: " .. fixturePath .. "\n")
  os.exit(2)
end
local fixtures = decodeJson(f:read("*a"))
f:close()

local failures = 0
for _, case in ipairs(fixtures.cases) do
  local graph = case.graph
  local ok, err = validateGraph(
    graph.activityList, graph.mapList, graph.functionList, graph.deviceList
  )
  local passed
  if case.expect == "valid" then
    passed = ok == true
  else
    passed = ok == nil and type(err) == "string" and
      string.find(err, case.errorIncludes, 1, true) ~= nil
  end
  if passed then
    print("PASS " .. case.name)
  else
    failures = failures + 1
    print("FAIL " .. case.name .. " (ok=" .. tostring(ok) ..
      ", err=" .. tostring(err) .. ", expect=" .. case.expect .. ")")
  end
end
print(string.format("%d/%d cases passed", #fixtures.cases - failures, #fixtures.cases))
os.exit(failures == 0 and 0 or 1)
