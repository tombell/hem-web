#!/usr/bin/env python3
"""One-shot, existing-container-only recovery. Never manage the shared runtime."""

import argparse
import fcntl
import json
import os
from pathlib import Path
import stat
import subprocess
import time
import urllib.request


class RecoveryError(Exception):
    pass


def run(cli, *args, timeout=45):
    try:
        result = subprocess.run(
            [cli, *args], capture_output=True, text=True, timeout=timeout, check=False
        )
    except (OSError, subprocess.TimeoutExpired):
        raise RecoveryError("container command unavailable or timed out") from None
    if result.returncode:
        # Runtime output/inspect can include environment values. Never echo it.
        raise RecoveryError("container command failed")
    return result.stdout


def validate(target, name, port):
    config = target["configuration"]
    expected_volume = name + "-data"
    ports = config["publishedPorts"]
    mounts = config["mounts"]
    process = config["initProcess"]
    user = process["user"]
    safe_user = user == {"raw": {"userString": "1000:1000"}} or user == {
        "id": {"uid": 1000, "gid": 1000}
    }
    volumes = [m for m in mounts if m["destination"] == "/data"]
    tmp = [m for m in mounts if m["destination"] == "/tmp"]
    if not (
        target["id"] == name
        and len(ports) == 1
        and ports[0] == {
            "hostAddress": "127.0.0.1",
            "hostPort": port,
            "containerPort": 3000,
            "proto": "tcp",
            "count": 1,
        }
        and len(volumes) == 1
        and volumes[0]["type"].get("volume", {}).get("name") == expected_volume
        and len(mounts) == 1 + len(tmp)
        and len(tmp) <= 1
        and all("tmpfs" in m["type"] for m in tmp)
        and config["readOnly"] is True
        and config["capDrop"] == ["ALL"]
        and config["capAdd"] == []
        and config["publishedSockets"] == []
        and config["ssh"] is False
        and safe_user
    ):
        raise RecoveryError("refusing unexpected container isolation/topology")


def host_ready(port):
    try:
        # Ignore inherited HTTP_PROXY variables for this strictly local probe.
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(f"http://127.0.0.1:{port}/ready", timeout=3) as response:
            return response.status == 200 and json.load(response).get("ok") is True
    except (OSError, ValueError):
        return False


def internal_ready(cli, name):
    script = (
        'try { const r=await fetch("http://127.0.0.1:3000/ready",'
        '{signal:AbortSignal.timeout(3000)});'
        'if(r.status!==200||(await r.json()).ok!==true)process.exit(1);'
        '} catch { process.exit(1); }'
    )
    try:
        run(cli, "exec", name, "node", "--input-type=module", "-e", script, timeout=10)
        return True
    except RecoveryError:
        return False


def save(path, state):
    temporary = path.with_suffix(".new")
    with temporary.open("w") as stream:
        json.dump(state, stream)
    os.replace(temporary, path)


def recover(cli, name, port, directory):
    if (directory / "maintenance").exists():
        return "maintenance: no action"
    targets = json.loads(run(cli, "inspect", name))
    if len(targets) != 1:
        raise RecoveryError("expected exactly one existing container")
    target = targets[0]
    validate(target, name, port)
    path = directory / "state.json"
    state = json.loads(path.read_text()) if path.exists() else {}
    status = target["status"]
    # Container 1.6.1 inspect/list use a status object; tolerate string fixtures.
    status = status.get("state") if isinstance(status, dict) else status
    now = time.time()
    if status == "running" and host_ready(port):
        save(path, {"failures": 0, "lastRecovery": state.get("lastRecovery", 0)})
        return "ready: no action"
    if status not in ("running", "stopped"):
        raise RecoveryError("unexpected container state; no action")
    failures = state.get("failures", 0) + 1
    state["failures"] = failures
    save(path, state)
    if status == "running" and failures < 3:
        return "not ready: awaiting consecutive failure threshold"
    if status == "running" and internal_ready(cli, name):
        raise RecoveryError("host forwarding failed; internal app ready; no restart")
    if now - state.get("lastRecovery", 0) < 300:
        raise RecoveryError("recovery cooldown; no action")
    state["lastRecovery"] = now
    save(path, state)
    # Recheck the operator marker immediately before either mutation.
    if (directory / "maintenance").exists():
        return "maintenance: no action"
    if status == "running":
        run(cli, "stop", "--time", "30", name, timeout=45)
    if (directory / "maintenance").exists():
        return "maintenance: stopped, start suppressed"
    run(cli, "start", name, timeout=60)
    for _ in range(20):
        if host_ready(port):
            save(path, {"failures": 0, "lastRecovery": now})
            return "recovered: host ready"
        time.sleep(1)
    raise RecoveryError("started container but host readiness failed")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--name", choices=["hem-web", "hem-web-test"], required=True)
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--state-dir", type=Path, required=True)
    parser.add_argument("--container-bin", default="/opt/homebrew/bin/container")
    args = parser.parse_args()
    if args.port != {"hem-web": 3000, "hem-web-test": 13000}[args.name]:
        parser.error("name and port must match the site contract")
    os.umask(0o077)
    try:
        args.state_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        info = args.state_dir.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise RecoveryError("state directory must be owner-only, owned, and not a symlink")
        with (args.state_dir / "lock").open("a") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                return
            print("hem-web watchdog: " + recover(
                args.container_bin, args.name, args.port, args.state_dir
            ))
    except (RecoveryError, OSError, ValueError, KeyError, TypeError) as error:
        # All errors are deliberately generic: no raw inspect/HTTP/env output.
        message = str(error) if isinstance(error, RecoveryError) else "invalid state/configuration"
        print("hem-web watchdog: " + message)
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
