#!/usr/bin/env python3
"""Download one device's command set from Logitech's catalog, on your computer.

This runs on your Mac/PC, never on the hub. It signs in to YOUR Logitech
account once, downloads the device you name, and writes a small JSON package
you then open in the web UI (Import codes -> Logitech catalog). The hub
never sees your sign-in.

    python3 tools/catalog/harmony_catalog.py Sony STR-DG720
    python3 tools/catalog/harmony_catalog.py Sony STR-DG720 --output ~/Downloads/

First run needs two things, once:
  1. Logitech's client_id, pulled out of YOUR OWN copy of the Harmony
     Android APK (it is Logitech's credential, so it is not shipped here):
         ~/Downloads/harmony.apk   (any recent Harmony app APK)
     or:  MELODIOUS_HARMONY_APK=/path/to.apk, or --apk, or extract it
     yourself and set MELODIOUS_CLIENT_ID.
  2. Your Logitech email. The password is prompted (never saved); tokens
     go to ~/.melodious/harmony_token.json (mode 0600) and the password
     goes nowhere.

Etiquette: the catalog is queried like the official app queries it, for one
device at a time, read-only. Nothing is created or changed in your account.
Run it only for devices you own. Last verified against the live service
2026-10-22.
"""

from __future__ import annotations

import argparse
import getpass
import http.cookiejar
import json
import os
import re
import struct
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile
from dataclasses import dataclass
from pathlib import Path

DISCOVERY_URL = "https://cf-svcs.myharmony.com/Discovery/Discovery.svc/json/GetJsonOperations"
DISCOVERY_CLIENT_TYPE = "Redbull 1.0"
LIP_SIGNIN_URL = "https://accounts.logi.com/identity/signin"
LIP_REFRESH_URL = "https://accounts.logi.com/identity/refresh"
HARMONY_SIGNIN_URL = "https://lb-svcs.myharmony.com/CompositeSecurityServices/Security.svc/json2/signin"
SEARCH_OPERATION = "DeviceManager/SearchGlobalDevices"
GLOBAL_DEVICES_OPERATION = "DeviceManager/GetGlobalDevices"
GLOBAL_LANGUAGE_COMMANDS_OPERATION = "DeviceManager/GetGlobalLanguageCommands"
COMMANDS_OPERATION = "DeviceManager/GetCommands"
TIMEOUT = 30.0
PACKAGE_SCHEMA = "0.2.0"
DEFAULT_TOKEN_FILE = Path.home() / ".melodious" / "harmony_token.json"
DEFAULT_APK_GLOB = ("~/Downloads/harmony*.apk", "~/Downloads/Harmony*.apk")


class CatalogError(RuntimeError):
    pass


# --------------------------------------------------------------------------
# JSON over HTTPS with a cookie jar (the session cookies must travel)
# --------------------------------------------------------------------------
class JsonClient:
    def __init__(self, timeout: float = TIMEOUT) -> None:
        self._jar = http.cookiejar.CookieJar()
        self._opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self._jar))
        self._timeout = timeout

    def cookies(self) -> dict[str, str]:
        return {c.name: c.value or "" for c in self._jar}

    def post(self, url: str, payload: object, *, token: str | None = None,
             headers: dict[str, str] | None = None) -> tuple[int, object]:
        request = urllib.request.Request(
            url, data=json.dumps(payload).encode("utf-8"), method="POST")
        request.add_header("Content-Type", "application/json")
        request.add_header("Accept", "application/json")
        request.add_header("User-Agent", os.environ.get("MELODIOUS_USER_AGENT", "melodious-catalog/1.0"))
        if token:
            request.add_header("Authorization", "Bearer " + token)
        for name, value in (headers or {}).items():
            request.add_header(name, value)
        try:
            with self._opener.open(request, timeout=self._timeout) as response:
                return response.status, _decode(response.read())
        except urllib.error.HTTPError as error:
            return error.code, _decode(error.read())
        except (urllib.error.URLError, OSError) as error:
            raise CatalogError(f"could not reach {urllib.parse.urlsplit(url).netloc}: {error}") from None


def _decode(body: bytes) -> object:
    if not body:
        return None
    try:
        return json.loads(body.decode("utf-8", errors="replace"))
    except ValueError:
        return None


# --------------------------------------------------------------------------
# client_id: out of your own APK, never shipped
# --------------------------------------------------------------------------
_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-z]{12}$")


def _pool_strings(data: bytes, off: int = 12) -> list[str]:
    kind, header, _size = struct.unpack_from("<HHI", data, off)
    if kind != 0x0001:
        raise ValueError("no ResStringPool at the expected offset")
    n, _styles, flags, start, _ = struct.unpack_from("<IIIII", data, off + 8)
    utf8 = bool(flags & (1 << 8))
    offsets = struct.unpack_from("<%dI" % n, data, off + header)
    base = off + start
    out: list[str] = []
    for o in offsets:
        pos = base + o
        try:
            if utf8:
                size = data[pos]
                pos += 1
                if size & 0x80:
                    size = ((size & 0x7F) << 8) | data[pos]
                    pos += 1
                pos += 1  # encoded byte length, not needed
                out.append(data[pos:pos + size].decode("utf-8", "replace"))
            else:
                size = struct.unpack_from("<H", data, pos)[0]
                pos += 2
                if size & 0x8000:
                    lo = struct.unpack_from("<H", data, pos)[0]
                    pos += 2
                    size = ((size & 0x7FFF) << 16) | lo
                out.append(data[pos:pos + size * 2].decode("utf-16-le", "replace"))
        except (IndexError, struct.error):
            out.append("")
    return out


def extract_client_id(apk_path: Path) -> str:
    with zipfile.ZipFile(apk_path) as z:
        data = z.read("resources.arsc")
    candidates = [s for s in _pool_strings(data) if _UUID.match(s)]
    if len(candidates) != 1:
        raise CatalogError(
            f"expected exactly one client_id in {apk_path}, found {len(candidates)}; "
            "not guessing. Set MELODIOUS_CLIENT_ID yourself if you already have it.")
    return candidates[0]


def find_apk(explicit: str | None) -> Path | None:
    candidates: list[Path] = []
    if explicit:
        candidates.append(Path(explicit).expanduser())
    env = os.environ.get("MELODIOUS_HARMONY_APK", "").strip()
    if env:
        candidates.append(Path(env).expanduser())
    for pattern in DEFAULT_APK_GLOB:
        candidates.extend(sorted(Path(p).expanduser() for p in Path().glob(pattern[2:])) if False else [])
        candidates.extend(sorted(Path(os.path.expanduser(pattern)).parent.glob(Path(pattern).name)))
    for path in candidates:
        if path.is_file():
            return path
    return None


def client_id(explicit_apk: str | None) -> str:
    from_env = os.environ.get("MELODIOUS_CLIENT_ID", "").strip()
    if from_env:
        return from_env
    apk = find_apk(explicit_apk)
    if apk is None:
        raise CatalogError(
            "Logitech's client_id is missing, and without it their account "
            "service answers 401.\nIt is not shipped here: it is Logitech's "
            "credential.\nEither put your Harmony app APK at "
            "~/Downloads/harmony.apk (or pass --apk / set "
            "MELODIOUS_HARMONY_APK), or extract it once and set "
            "MELODIOUS_CLIENT_ID.")
    return extract_client_id(apk)


# --------------------------------------------------------------------------
# tokens on disk (0600, atomic)
# --------------------------------------------------------------------------
@dataclass(frozen=True)
class LipTokens:
    access_token: str
    id_token: str
    refresh_token: str | None = None

    @classmethod
    def from_mapping(cls, value: object) -> "LipTokens":
        if not isinstance(value, dict):
            raise CatalogError("the sign-in answer was not a JSON object")
        access, identity, refresh = value.get("access_token"), value.get("id_token"), value.get("refresh_token")
        if not isinstance(access, str) or not isinstance(identity, str):
            raise CatalogError("access_token or id_token is missing from the sign-in answer")
        return cls(access, identity, refresh if isinstance(refresh, str) else None)

    def to_dict(self) -> dict[str, str]:
        result = {"access_token": self.access_token, "id_token": self.id_token}
        if self.refresh_token:
            result["refresh_token"] = self.refresh_token
        return result


def save_tokens(tokens: LipTokens, token_file: Path) -> None:
    token_file.parent.mkdir(parents=True, exist_ok=True)
    handle, tmp_name = tempfile.mkstemp(dir=token_file.parent, prefix="." + token_file.name + ".", suffix=".tmp")
    tmp = Path(tmp_name)
    try:
        if os.name == "posix":
            os.fchmod(handle, 0o600)
        with os.fdopen(handle, "w", encoding="utf-8") as stream:
            json.dump(tokens.to_dict(), stream, ensure_ascii=False, indent=2, sort_keys=True)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(tmp, token_file)
        if os.name == "posix":
            token_file.chmod(0o600)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise


def load_tokens(token_file: Path) -> LipTokens | None:
    try:
        return LipTokens.from_mapping(json.loads(token_file.read_text(encoding="utf-8")))
    except (OSError, ValueError, CatalogError):
        return None


# --------------------------------------------------------------------------
# the three sign-in calls + refresh cascade
# --------------------------------------------------------------------------
def _rejected(what: str, status: int) -> str:
    hint = " -- either the email/password is wrong, or the client_id is not the one Logitech's own client uses" if status in (401, 403) else ""
    return f"{what}: HTTP {status}{hint}"


def lip_login(client: JsonClient, email: str, password: str, cid: str) -> LipTokens:
    status, payload = client.post(LIP_SIGNIN_URL, {
        "email": email, "password": password, "client_id": cid,
        "channel_id": str(uuid.uuid4()),
    })
    if status != 200:
        raise CatalogError(_rejected("Logitech rejected the login", status))
    return LipTokens.from_mapping(payload)


def lip_refresh(client: JsonClient, tokens: LipTokens, cid: str) -> LipTokens:
    if not tokens.refresh_token:
        raise CatalogError("there is no refresh_token; a login is needed")
    status, payload = client.post(LIP_REFRESH_URL, {"refresh_token": tokens.refresh_token, "client_id": cid})
    if status != 200:
        raise CatalogError(_rejected("Logitech rejected the renewal", status))
    return LipTokens.from_mapping(payload)


@dataclass(frozen=True)
class HarmonySession:
    account_id: str
    tokens: LipTokens


def harmony_signin(client: JsonClient, tokens: LipTokens) -> HarmonySession:
    status, payload = client.post(
        HARMONY_SIGNIN_URL,
        {"access_token": tokens.access_token, "id_token": tokens.id_token},
        token=tokens.access_token)
    if status != 200:
        raise CatalogError(_rejected("Harmony rejected the bootstrap", status))
    if not isinstance(payload, dict):
        raise CatalogError("Harmony's signin did not return an object")
    account_id = payload.get("AccountId")
    if not isinstance(account_id, str):
        raise CatalogError("Harmony's signin did not return an AccountId")
    if payload.get("IsLockedOut") is True:
        raise CatalogError("the Harmony account is locked")
    return HarmonySession(account_id=account_id, tokens=tokens)


def ensure_session(client: JsonClient, email: str, token_file: Path, cid: str) -> tuple[HarmonySession, bool]:
    """(session, needed_password). Tries saved tokens, then refresh; if both
    fail, asks the caller for a password (this function never prompts, so it
    stays testable and scriptable)."""
    tokens = load_tokens(token_file)
    if tokens is not None:
        try:
            return harmony_signin(client, tokens), False
        except CatalogError:
            pass
        try:
            tokens = lip_refresh(client, tokens, cid)
            save_tokens(tokens, token_file)
            return harmony_signin(client, tokens), False
        except CatalogError:
            pass
    password = getpass.getpass(f"Logitech password for {email} (not saved): ")
    if not password:
        raise CatalogError("no password given")
    tokens = lip_login(client, email, password, cid)
    save_tokens(tokens, token_file)
    return harmony_signin(client, tokens), True


# --------------------------------------------------------------------------
# catalog reads (read-only, one device)
# --------------------------------------------------------------------------
def _swap_host(address: str, hosts: set[str], new_host: str) -> str:
    parts = urllib.parse.urlsplit(address)
    if parts.hostname not in hosts:
        return address
    netloc = new_host + (f":{parts.port}" if parts.port else "")
    return urllib.parse.urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment))


def load_balancer_address(address: str) -> str:
    return _swap_host(address, {"svcs.myharmony.com", "cf-svcs.myharmony.com"}, "lb-svcs.myharmony.com")


@dataclass(frozen=True)
class Operation:
    identifier: str
    address: str
    name: str

    def endpoint(self, *, json2: bool = False) -> str:
        address = _swap_host(self.address, {"svcs.myharmony.com"}, "cf-svcs.myharmony.com")
        if json2:
            address = address.replace("/json/", "/json2/")
        return address + self.name


def parse_operations(payload: object) -> dict[str, Operation]:
    if not isinstance(payload, dict) or not isinstance(payload.get("GetJsonOperationsResult"), list):
        raise CatalogError("discovery did not return an operation table")
    operations: dict[str, Operation] = {}
    for item in payload["GetJsonOperationsResult"]:
        if not isinstance(item, dict):
            continue
        identifier, address, name = item.get("Identifier"), item.get("Address"), item.get("Name")
        if isinstance(identifier, str) and identifier and isinstance(address, str) and address and isinstance(name, str) and name:
            operations[identifier] = Operation(identifier, address, name)
    if not operations:
        raise CatalogError("discovery carried no usable operation")
    return operations


class GlobalCatalogClient:
    def __init__(self, client: JsonClient, session: HarmonySession) -> None:
        self._client = client
        self._session = session
        self._operations: dict[str, Operation] | None = None

    @property
    def _bearer(self) -> str:
        return self._session.tokens.access_token

    def signin(self) -> HarmonySession:
        self._session = harmony_signin(self._client, self._session.tokens)
        return self._session

    def operations(self) -> dict[str, Operation]:
        if self._operations is None:
            status, payload = self._client.post(
                DISCOVERY_URL, {"clientTypeId": DISCOVERY_CLIENT_TYPE}, token=self._bearer,
                headers={"Content-Type": "application/json; charset=utf-8", "x-logitech-api-version": "1"})
            if status != 200:
                raise CatalogError(f"discovery failed with HTTP {status}")
            self._operations = parse_operations(payload)
        return dict(self._operations)

    def _post(self, identifier: str, data: object, *, json2: bool = False,
              fallback_name: str | None = None) -> object:
        table = self.operations()
        operation = table.get(identifier)
        if operation is None and fallback_name:
            sibling = table.get(COMMANDS_OPERATION)
            if sibling is not None:
                operation = Operation(identifier, sibling.address, fallback_name)
        if operation is None:
            raise CatalogError(f"unknown catalog operation: {identifier}")
        endpoint = load_balancer_address(operation.endpoint(json2=json2))
        status, payload = self._client.post(endpoint, data, token=self._bearer)
        message = payload.get("Message") if isinstance(payload, dict) else None
        if status == 400 and isinstance(message, str) and "Access is denied" in message:
            raise CatalogError("Logitech refused the catalog session; sign in again")
        if status != 200:
            raise CatalogError(f"{identifier} failed with HTTP {status}" + (f": {message}" if message else ""))
        if payload is None:
            raise CatalogError(f"{identifier} returned HTTP 200 without JSON")
        if isinstance(payload, dict):
            result_key = operation.name + "Result"
            if result_key in payload:
                return payload[result_key]
            if "Data" in payload:
                return payload["Data"]
        return payload

    def search(self, manufacturer: str, model: str, *, max_results: int = 50) -> object:
        if not manufacturer.strip() or not model.strip():
            raise CatalogError("the catalog searches by manufacturer AND model; both are needed (part of the model is enough)")
        return self._post(SEARCH_OPERATION, {
            "manufacturer": manufacturer, "modelNumber": model,
            "deviceType": 0, "searchType": 2, "maxResults": max_results,
        }, json2=True)

    def global_devices(self, device_ids: list) -> object:
        return self._post(GLOBAL_DEVICES_OPERATION, [i for i in device_ids if i is not None], json2=True)

    def global_language_commands(self, version_id) -> object:
        if version_id is None:
            raise CatalogError("the global language version id is missing")
        return self._post(GLOBAL_LANGUAGE_COMMANDS_OPERATION,
                          {"globalLanguageVersionId": {"Value": version_id}},
                          fallback_name="GetGlobalLanguageCommands")


# --------------------------------------------------------------------------
# the offline package (what the web UI opens)
# --------------------------------------------------------------------------
_SECRET_KEY = re.compile(
    r"(authorization|cookie|password|passwd|secret|access.?token|refresh.?token|id.?token|auth.?token)",
    re.IGNORECASE)


def redact(value: object) -> object:
    if isinstance(value, dict):
        return {str(k): "[REDACTED]" if _SECRET_KEY.search(str(k)) else redact(v) for k, v in value.items()}
    if isinstance(value, list):
        return [redact(v) for v in value]
    return value


def build_package(*, manufacturer: str, model: str, search_result: object,
                  selected_match: object, global_device: object, language_commands: object) -> dict:
    from datetime import datetime, timezone
    resources = {
        "search_result": redact(search_result),
        "selected_match": redact(selected_match),
        "global_device": redact(global_device),
        "global_language_commands": redact(language_commands),
    }
    return {
        "schema_version": PACKAGE_SCHEMA,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "logitech-catalog-via-melodious-helper",
        "query": {"manufacturer": manufacturer, "model": model},
        "resources": resources,
    }


def search_matches(search_result: object) -> list[dict]:
    if not isinstance(search_result, dict):
        raise CatalogError("SearchGlobalDevices did not return an object")
    matches = search_result.get("Matches")
    if matches is None:
        raise CatalogError("Logitech's catalog did not search: it needs the manufacturer AND the model")
    if not isinstance(matches, list):
        raise CatalogError("SearchGlobalDevices did not return Matches")
    return [m for m in matches if isinstance(m, dict)]


def fetch_package(client: JsonClient, session: HarmonySession, manufacturer: str, model: str,
                  *, pick=None) -> dict:
    with GlobalCatalogClient(client, session) as catalog:
        catalog.signin()
        raw = catalog.search(manufacturer, model)
        matches = search_matches(raw)
        if not matches:
            raise CatalogError(f"no catalog device matches {manufacturer} {model}")
        selected = pick(matches) if pick else matches[0]
        global_id = selected.get("Id-")
        if not isinstance(global_id, (int, str)) or isinstance(global_id, bool):
            raise CatalogError("the selected result carries no device id")
        result = catalog.global_devices([global_id])
        if not isinstance(result, list) or not result or not isinstance(result[0], dict):
            raise CatalogError("GetGlobalDevices did not return the device")
        global_device = result[0]
        version_id = global_device.get("DefaultGlobalLanguageVersionId")
        if not isinstance(version_id, (int, str)) or isinstance(version_id, bool):
            raise CatalogError("the device carries no language version id")
        commands = catalog.global_language_commands(version_id)
    return build_package(manufacturer=manufacturer, model=model, search_result=raw,
                         selected_match=selected, global_device=global_device,
                         language_commands=commands)


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-") or "x"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("manufacturer")
    parser.add_argument("model")
    parser.add_argument("--email", default=os.environ.get("MELODIOUS_LOGITECH_EMAIL", ""))
    parser.add_argument("--output", default=".", help="directory for the package (default: current)")
    parser.add_argument("--apk", default=None, help="path to your Harmony app APK (for the client_id)")
    parser.add_argument("--list", action="store_true", help="list matches and exit without downloading")
    args = parser.parse_args(argv)

    email = args.email.strip()
    if not email:
        email = input("Logitech email: ").strip()
    if not email:
        print("An email is needed to sign in.", file=sys.stderr)
        return 2
    try:
        cid = client_id(args.apk)
        with JsonClient() as client:
            session, _ = ensure_session(client, email, DEFAULT_TOKEN_FILE, cid)
            if args.list:
                with GlobalCatalogClient(client, session) as catalog:
                    catalog.signin()
                    matches = search_matches(catalog.search(args.manufacturer, args.model))
                for i, match in enumerate(matches):
                    print(f"{i}: {match.get('Manufacturer', '')} {match.get('DeviceModel', '')} "
                          f"[{match.get('DisplayText') or match.get('SelectedText') or ''}] id={match.get('Id-')}")
                if not matches:
                    print(f"No catalog matches for {args.manufacturer} {args.model}.")
                return 0
            package = fetch_package(client, session, args.manufacturer, args.model)
    except CatalogError as error:
        print(f"harmony_catalog: {error}", file=sys.stderr)
        return 1
    output = Path(args.output).expanduser() / f"harmony-catalog-{_slug(args.manufacturer)}-{_slug(args.model)}.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(package, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    commands = package["resources"]["global_language_commands"]
    count = len(commands) if isinstance(commands, list) else 0
    match = package["resources"]["selected_match"]
    print(f"Wrote {output} ({count} commands for {match.get('Manufacturer', '')} {match.get('DeviceModel', '')}).")
    print("Now open it in the web UI: device page -> Import codes -> Logitech catalog.")
    return 0


# `with` support without a socket to close: kept for call-site symmetry.
GlobalCatalogClient.__enter__ = lambda self: self
GlobalCatalogClient.__exit__ = lambda self, *_: None


if __name__ == "__main__":
    raise SystemExit(main())
