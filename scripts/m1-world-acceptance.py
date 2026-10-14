"""Run the existing World production composition and exercise it in Chrome."""

from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path


def require_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"Required acceptance input {name} is missing")
    return value


frontend_root = Path(require_env("FRONTEND_ROOT")).resolve()
world_root = Path(require_env("WORLD_REPO")).resolve()
observation_root = Path(require_env("OBSERVATION_REPO")).resolve()
world_sha = require_env("WORLD_SHA")
observation_sha = require_env("OBSERVATION_SHA")
frontend_sha = require_env("FRONTEND_SHA")
frontend_origin = os.environ.get("FRONTEND_ORIGIN", "http://127.0.0.1:4173")


def git_head(path: Path) -> str:
    return subprocess.check_output(["git", "-C", str(path), "rev-parse", "HEAD"], text=True).strip()


def assert_clean(path: Path, label: str) -> None:
    status = subprocess.check_output(
        ["git", "-C", str(path), "status", "--porcelain=v1", "--untracked-files=all"], text=True
    )
    if status.strip():
        raise RuntimeError(f"{label} worktree is not clean; its HEAD does not identify all tested source")


if git_head(world_root) != world_sha or git_head(observation_root) != observation_sha:
    raise RuntimeError("Pinned World or Observation HEAD changed during acceptance setup")
assert_clean(world_root, "World")
assert_clean(observation_root, "Observation")
if git_head(frontend_root) != frontend_sha:
    raise RuntimeError("Frontend HEAD changed during acceptance setup")
assert_clean(frontend_root, "Frontend")

# Load only the existing World integration fixture. Its _run helper constructs
# real domain-owned state and invokes run_scalar_sensorimotor_cycle_and_publish;
# this harness does not fabricate or replace the causal composition.
test_path = world_root / "tests/integration/test_end_to_end_causal_cycle_acceptance.py"
if not test_path.is_file():
    raise RuntimeError(f"Pinned World integration test is missing: {test_path}")
sys.path.insert(0, str(world_root / "src"))
sys.path.insert(0, str(observation_root / "src"))
spec = importlib.util.spec_from_file_location("world_t12_acceptance", test_path)
if spec is None or spec.loader is None:
    raise RuntimeError("Could not load pinned World acceptance test module")
world_test = importlib.util.module_from_spec(spec)
spec.loader.exec_module(world_test)

from observation.http_bridge import LocalObservationReadBridge  # noqa: E402
from world.manifest import WorldCausalManifestStore  # noqa: E402


def run_browser(bridge_url: str, workspace: Path, *, expect_unavailable: bool = False) -> dict[str, object]:
    env = {
        **os.environ,
        "FRONTEND_ROOT": str(frontend_root),
        "FRONTEND_BRIDGE_URL": bridge_url,
        "FRONTEND_ORIGIN": frontend_origin,
        "FRONTEND_DIST": str(frontend_root / "dist"),
        "FRONTEND_BROWSER_PROFILE": str(
            workspace / ("chrome-profile-unavailable" if expect_unavailable else "chrome-profile")
        ),
        "EXPECT_UNAVAILABLE": "1" if expect_unavailable else "0",
    }
    completed = subprocess.run(
        ["node", str(frontend_root / "scripts/acceptance-browser.mjs")],
        cwd=frontend_root,
        env=env,
        check=False,
        capture_output=True,
        text=True,
        timeout=60,
    )
    if completed.returncode != 0:
        raise RuntimeError(
            "Browser acceptance runner failed with exit "
            f"{completed.returncode}:\n{completed.stdout}\n{completed.stderr}"
        )
    lines = [line for line in completed.stdout.splitlines() if line.startswith("M1_BROWSER_RESULT=")]
    if len(lines) != 1:
        raise RuntimeError(f"Browser runner did not emit one result record: {completed.stdout}\n{completed.stderr}")
    return json.loads(lines[0].split("=", 1)[1])


with tempfile.TemporaryDirectory(prefix="biopeia-m1-world-acceptance-") as temporary:
    work = Path(temporary)
    run_dir = work / "world-run"
    evidence: dict[str, object] = {}

    def after_commit(world, result, plane) -> None:
        if result.observation_publication.committed_cut != result.committed_cut:
            raise AssertionError("Observation publication does not reference the committed World cut")
        before_tick = world.causal_tick
        before_messages = plane.current_messages()
        before_manifest = WorldCausalManifestStore(run_dir / "manifest.json").read()
        if before_tick != result.committed_cut.causal_tick:
            raise AssertionError("World current causal tick differs from the committed cut")

        with LocalObservationReadBridge.create(
            plane,
            host="127.0.0.1",
            port=0,
            allowed_origin=frontend_origin,
        ) as bridge:
            host, port = bridge.address
            endpoint = f"http://{host}:{port}/v1/current"
            # The composed path must fail closed for a foreign browser origin.
            denied = urllib.request.Request(endpoint, headers={"Origin": "http://attacker.invalid"})
            try:
                urllib.request.urlopen(denied, timeout=2)
            except urllib.error.HTTPError as error:
                if error.code != 403:
                    raise AssertionError(f"Foreign origin returned {error.code}, expected 403") from error
            else:
                raise AssertionError("Observation bridge accepted a foreign Origin")
            browser = run_browser(endpoint, work)

        # The next real browser session exercises the truthful failure state
        # after the local bridge is unavailable. It cannot infer source absence.
        # Port 1 is used only as an explicit, expected-refused loopback target
        # so the failure assertion cannot race an unrelated service reusing
        # the ephemeral bridge port after teardown.
        unavailable_browser = run_browser(
            "http://127.0.0.1:1/v1/current", work, expect_unavailable=True
        )

        after_messages = plane.current_messages()
        after_manifest = WorldCausalManifestStore(run_dir / "manifest.json").read()
        if world.causal_tick != before_tick or world.causal_tick != result.committed_cut.causal_tick:
            raise AssertionError("Browser reads advanced or changed the causal World tick")
        if after_messages != before_messages:
            raise AssertionError("Browser reads mutated retained Observation messages")
        if after_manifest != before_manifest:
            raise AssertionError("Browser reads changed the committed World manifest")
        evidence.update(
            {
                "committed_world_id": result.committed_cut.world_id,
                "committed_tick": result.committed_cut.causal_tick,
                "commit_id": result.committed_cut.commit_id,
                "observation_sequences": list(result.observation_publication.delivery_sequences),
                "retained_message_count": len(after_messages),
                "world_tick_unchanged": True,
                "observation_messages_unchanged": True,
                "world_manifest_unchanged": True,
                "foreign_origin_rejected": True,
                "browser": browser,
                "unavailable_browser": unavailable_browser,
            }
        )

    result, messages, resumed, _ = world_test._run(
        run_dir,
        stop_after_first=True,
        continue_from_live_state=True,
        after_first_commit=after_commit,
    )
    if resumed is not None or result.committed_cut.causal_tick != 1 or len(messages) != 2:
        raise AssertionError("Expected one real committed cycle and two owner publications")
    if not evidence or evidence["retained_message_count"] != len(messages):
        raise AssertionError(
            "Browser acceptance callback did not complete with the committed "
            f"evidence_fields={len(evidence)}, "
            f"retained_message_count={evidence.get('retained_message_count')}, "
            f"committed_message_count={len(messages)}"
        )

report = {
    "status": "PASS",
    "front_end_sha": frontend_sha,
    "world_sha": world_sha,
    "observation_sha": observation_sha,
    "browser_version": evidence["browser"]["browser_version"],
    "browser": evidence["browser"],
    "unavailable_browser": evidence["unavailable_browser"],
    "world_observation": evidence,
    "limitations": [
        "One bounded local single-process current-view acceptance run only.",
        "No remote access, durable history, deployment, scientific efficacy, or atomic cross-owner snapshot is demonstrated.",
    ],
}
print("M1_ACCEPTANCE_RESULT=" + json.dumps(report, sort_keys=True))
