"""Run one real World M1 process while one real Chrome page reads its live bridge."""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import tempfile
import time
import tomllib
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


def required(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"Required live acceptance input {name} is missing")
    return value


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def git(path: Path, *args: str) -> str:
    return subprocess.check_output(["git", "-C", str(path), *args], text=True).strip()


frontend = Path(required("FRONTEND_ROOT")).resolve()
frontend_sha = required("FRONTEND_SHA")
world = Path(required("WORLD_REPO")).resolve()
world_sha = required("WORLD_SHA")
bridge_bin = Path(required("WORLD_M1_BIN")).resolve()
profile_path = Path(required("WORLD_PROFILE")).resolve()
observation_repo = Path(required("OBSERVATION_REPO")).resolve()
expected_observation_sha = required("OBSERVATION_SHA")
frontend_origin = os.environ.get("FRONTEND_ORIGIN", "http://127.0.0.1:4173")
chrome_bin = os.environ.get("CHROME_BIN", "/usr/bin/google-chrome")

if git(frontend, "rev-parse", "HEAD") != frontend_sha or git(frontend, "status", "--porcelain=v1", "--untracked-files=all"):
    raise RuntimeError("Frontend candidate changed or is dirty")
if git(world, "rev-parse", "HEAD") != world_sha or git(world, "status", "--porcelain=v1", "--untracked-files=all"):
    raise RuntimeError("World source changed or is dirty")
if not profile_path.is_file() or profile_path.is_symlink() or not profile_path.is_relative_to(world):
    raise RuntimeError("World operator profile must be a regular file inside the exact World checkout")
if not bridge_bin.is_file():
    raise RuntimeError("World M1 executable is unavailable")

with (world / "pyproject.toml").open("rb") as handle:
    project = tomllib.load(handle)["project"]
runtime_requirements = project["optional-dependencies"]["runtime"]
pins: dict[str, str] = {}
for requirement in runtime_requirements:
    name, uri = requirement.split(" @ ", 1)
    pins[name] = uri.rsplit("@", 1)[1]
    repo_key = {"organism": "ORGANISM_REPO", "embodiment": "EMBODIMENT_REPO", "environment": "ENVIRONMENT_REPO", "modality": "MODALITY_REPO", "observation": "OBSERVATION_REPO"}[name]
    repo_path = Path(required(repo_key)).resolve()
    try:
        git(repo_path, "cat-file", "-e", f"{pins[name]}^{{commit}}")
    except subprocess.CalledProcessError as error:
        raise RuntimeError(f"Pinned {name} revision is unavailable in its supplied checkout: {pins[name]}") from error
    if name == "observation" and pins[name] != expected_observation_sha:
        raise RuntimeError(f"Observation pin mismatch: expected {expected_observation_sha}, World declares {pins[name]}")

try:
    subprocess.run(["node", "--version"], check=True, stdout=subprocess.PIPE)
    subprocess.run([chrome_bin, "--version"], check=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
except (OSError, subprocess.CalledProcessError) as error:
    raise RuntimeError(f"Browser acceptance prerequisites unavailable: {error}") from error

profile_sha = hashlib.sha256(profile_path.read_bytes()).hexdigest()
with tempfile.TemporaryDirectory(prefix="biopeia-m1-live-") as temporary:
    state_parent = Path(temporary)
    state_root = state_parent / "world-state"
    command = [str(bridge_bin), "--profile", str(profile_path), "--state-root", str(state_root), "--cycles", "20"]
    world_process = subprocess.Popen(command, cwd=world, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
    world_events: list[dict[str, object]] = []
    event_times: dict[int, str] = {}
    browser_process: subprocess.Popen[str] | None = None
    browser_stdout: str | None = None
    browser_stderr: str | None = None
    browser_result: dict[str, object] | None = None
    terminal: dict[str, object] | None = None
    started_at = utc_now()
    browser_ready_path = state_parent / "browser-ready.json"
    browser_attached_at: str | None = None
    try:
        assert world_process.stdout is not None
        for line in world_process.stdout:
            record = json.loads(line)
            if not isinstance(record, dict) or "event" not in record:
                raise RuntimeError(f"World emitted malformed lifecycle JSON: {line!r}")
            record["observed_at_utc"] = utc_now()
            world_events.append(record)
            if record.get("event") == "ready":
                bridge_url = str(record.get("observation_bridge", "")) + "/v1/current"
                request = urllib.request.Request(bridge_url, headers={"Origin": "http://attacker.invalid"})
                try:
                    urllib.request.urlopen(request, timeout=2)
                except urllib.error.HTTPError as error:
                    if error.code != 403:
                        raise RuntimeError(f"Foreign Origin received {error.code}, expected 403") from error
                else:
                    raise RuntimeError("Observation bridge accepted a foreign Origin")

                browser_env = {
                    **os.environ,
                    "FRONTEND_ROOT": str(frontend),
                    "FRONTEND_BRIDGE_URL": bridge_url,
                    "FRONTEND_ORIGIN": frontend_origin,
                    "CHROME_BIN": chrome_bin,
                    "BROWSER_READY_PATH": str(browser_ready_path),
                }
                browser_process = subprocess.Popen(
                    ["node", str(frontend / "scripts/acceptance-live-browser.mjs")],
                    cwd=frontend, env=browser_env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                )
                deadline = time.monotonic() + 15
                while time.monotonic() < deadline and not browser_ready_path.is_file():
                    if browser_process.poll() is not None:
                        out, err = browser_process.communicate()
                        raise RuntimeError(f"Browser exited before attaching to the live bridge ({browser_process.returncode}):\n{out}\n{err}")
                    time.sleep(0.05)
                if not browser_ready_path.is_file():
                    raise RuntimeError("Real browser did not attach to the live bridge before timeout")
                browser_attached_at = json.loads(browser_ready_path.read_text(encoding="utf-8"))["browser_page_attached_at_utc"]
            if record.get("event") == "cycle_committed":
                tick = record.get("last_verified_committed_tick")
                if not isinstance(tick, int):
                    raise RuntimeError(f"World commit event lacks verified tick: {record}")
                event_times[tick] = str(record["observed_at_utc"])
            if record.get("event") in {"completed", "stopped", "failed"}:
                terminal = record
        rc = world_process.wait(timeout=30)
        if browser_process is None:
            raise RuntimeError("World never emitted ready; browser was not started")
        browser_stdout, browser_stderr = browser_process.communicate(timeout=70)
        if browser_process.returncode != 0:
            raise RuntimeError(f"Live browser failed ({browser_process.returncode}):\n{browser_stdout}\n{browser_stderr}")
        lines = [line for line in browser_stdout.splitlines() if line.startswith("M1_LIVE_BROWSER_RESULT=")]
        if len(lines) != 1:
            raise RuntimeError(f"Browser did not emit exactly one machine result: {browser_stdout}")
        browser_result = json.loads(lines[0].split("=", 1)[1])
        if rc != 0 or terminal is None or terminal.get("event") != "completed":
            stderr = world_process.stderr.read() if world_process.stderr else ""
            raise RuntimeError(f"World did not complete cleanly (rc={rc}, terminal={terminal}): {stderr}")
    finally:
        if browser_process is not None and browser_process.poll() is None:
            browser_process.terminate()
            browser_process.wait(timeout=10)
        if world_process.poll() is None:
            world_process.terminate()
            world_process.wait(timeout=10)

if browser_result is None or terminal is None:
    raise RuntimeError("Acceptance result was incomplete")

source_revisions = terminal.get("source_revisions")
if not isinstance(source_revisions, dict):
    raise RuntimeError("Terminal World lifecycle record omitted exact source revisions")
for package, sha in pins.items():
    if source_revisions.get(package) != sha:
        raise RuntimeError(f"World runtime used unexpected {package} source: {source_revisions.get(package)} != {sha}")
if source_revisions.get("world") != world_sha:
    raise RuntimeError(f"World runtime reports source {source_revisions.get('world')}, expected {world_sha}")
if source_revisions.get("observation") != expected_observation_sha:
    raise RuntimeError("World runtime Observation source does not match the pinned bridge source")
if terminal.get("last_verified_committed_tick") != 20:
    raise RuntimeError(f"Expected 20 committed cycles for bounded live check, got {terminal}")

attached_at = datetime.fromisoformat(str(browser_attached_at).replace("Z", "+00:00"))
snapshots = browser_result.get("snapshots")
if not isinstance(snapshots, list):
    raise RuntimeError("Browser result omitted rendered current-view snapshots")
ticks_seen = {snapshot.get("tick") for snapshot in snapshots if isinstance(snapshot, dict)}
live_ticks = []
for tick in sorted(ticks_seen):
    event_time = event_times.get(tick)
    if not event_time:
        continue
    committed_at = datetime.fromisoformat(event_time.replace("Z", "+00:00"))
    observed = next(
        datetime.fromisoformat(str(snapshot["observed_at_utc"]).replace("Z", "+00:00"))
        for snapshot in snapshots if isinstance(snapshot, dict) and snapshot.get("tick") == tick
    )
    if attached_at <= committed_at <= observed:
        live_ticks.append(tick)
if len(set(live_ticks)) < 2:
    raise RuntimeError(f"Fewer than two committed cuts occurred while browser was attached and then observed: {live_ticks}")

unavailable_env = {
    **os.environ,
    "FRONTEND_ROOT": str(frontend),
    "FRONTEND_DIST": str(frontend / "dist"),
    "FRONTEND_BRIDGE_URL": "http://127.0.0.1:1/v1/current",
    "FRONTEND_ORIGIN": frontend_origin,
    "EXPECT_UNAVAILABLE": "1",
    "CHROME_BIN": chrome_bin,
}
unavailable = subprocess.run(
    ["node", str(frontend / "scripts/acceptance-browser.mjs")],
    cwd=frontend, env=unavailable_env, check=False, capture_output=True, text=True, timeout=60,
)
if unavailable.returncode != 0:
    raise RuntimeError(f"Unavailable-state browser check failed:\n{unavailable.stdout}\n{unavailable.stderr}")
unavailable_lines = [line for line in unavailable.stdout.splitlines() if line.startswith("M1_BROWSER_RESULT=")]
if len(unavailable_lines) != 1:
    raise RuntimeError(f"Unavailable browser omitted one machine result: {unavailable.stdout}")
unavailable_result = json.loads(unavailable_lines[0].split("=", 1)[1])

report = {
    "status": "PASS",
    "command": command,
    "started_at_utc": started_at,
    "frontend_sha": frontend_sha,
    "world_sha": source_revisions["world"],
    "source_revisions": {name: source_revisions[name] for name in ["organism", "embodiment", "environment", "modality", "observation"]},
    "profile_id": next((event.get("profile_id") for event in world_events if event.get("event") == "ready"), None),
    "profile_sha256": profile_sha,
    "process_run_id": terminal.get("run_id"),
    "world_committed_events": [
        {"tick": event.get("last_verified_committed_tick"), "commit_id": event.get("commit_id"), "observed_at_utc": event.get("observed_at_utc")}
        for event in world_events if event.get("event") == "cycle_committed"
    ],
    "browser": browser_result,
    "browser_attached_at_utc": browser_attached_at,
    "unavailable_browser": unavailable_result,
    "browser_observed_commits_while_attached": live_ticks,
    "terminal": terminal,
    "checks": {"approved_families_only": True, "source_lineage_visible": True, "repeated_reads_are_get": True,
               "foreign_origin_rejected": True, "no_non_same_origin_browser_requests": True,
               "browser_attached_during_at_least_two_commits": True},
    "limitations": [
        "Twenty committed ticks in one fresh local session only; this does not establish tolerance at 24 or more cycles.",
        "Loopback current-view only; no history, remote access, scientific efficacy, or atomic cross-owner snapshot is demonstrated.",
        "Unavailable-state behavior is covered by the existing separate bounded browser acceptance, not a source-absence claim.",
    ],
}
print("M1_LIVE_ACCEPTANCE_RESULT=" + json.dumps(report, sort_keys=True))
