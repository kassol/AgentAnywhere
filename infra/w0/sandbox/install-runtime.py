#!/usr/bin/env python3
"""Register the W0 runtime on cc-la. Requires explicit --apply; never restarts Docker."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import tarfile
import tempfile
import time
import urllib.request

RELEASE = "release-20260914.0"
SHA512 = "ff1c0577c8daa0e3511aedad554c3d5e20fa184b4ddd422454f573d60a8b9774f972755ca5c7f56588c5b4f42345b60b2ead077f35d7d3235e23f57c0fa194ca"
RUNTIME = "agentanywhere-w0-runsc"
DEST = Path("/opt/agentanywhere-w0-runtime-" + RELEASE)
ENTRY = {"path": str(DEST / "runsc")}


def merge_runtime(raw):
    config = json.loads(raw or b"{}")
    if not isinstance(config, dict):
        raise ValueError("daemon configuration must be an object")
    runtimes = config.setdefault("runtimes", {})
    if not isinstance(runtimes, dict):
        raise ValueError("runtimes must be an object")
    if RUNTIME in runtimes and runtimes[RUNTIME] != ENTRY:
        raise ValueError("W0 runtime already exists with different configuration")
    runtimes[RUNTIME] = ENTRY
    return (json.dumps(config, indent=2) + "\n").encode()


def run(*args):
    return subprocess.check_output(args, text=True).strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if not args.apply:
        parser.error("Preparation only. Run on cc-la with --apply after reviewing this script.")
    if os.geteuid() != 0 or platform.system() != "Linux" or platform.machine() != "x86_64":
        raise SystemExit("Requires Linux x86_64 root on cc-la")
    if run("systemctl", "show", "docker", "-p", "CanReload", "--value") != "yes":
        raise SystemExit("Docker cannot reload; stop without restarting")
    config = Path("/etc/docker/daemon.json")
    if config.is_symlink():
        raise SystemExit("Review symlinked daemon.json manually")
    original = config.read_bytes() if config.exists() else None
    candidate = merge_runtime(original)
    with tempfile.TemporaryDirectory(prefix="agentanywhere-runtime-") as temp:
        temp = Path(temp)
        archive = temp / "gvisor.tar.bz2"
        url = f"https://github.com/google/gvisor/releases/download/{RELEASE}/gvisor-x86_64.tar.bz2"
        urllib.request.urlretrieve(url, archive)
        if hashlib.sha512(archive.read_bytes()).hexdigest() != SHA512:
            raise SystemExit("gVisor SHA512 mismatch")
        unpacked = temp / "unpacked"
        with tarfile.open(archive) as tar:
            tar.extractall(unpacked, filter="data")
        binaries = list(unpacked.rglob("runsc"))
        if len(binaries) != 1:
            raise SystemExit("Unexpected gVisor archive layout")
        source = binaries[0].parent
        if DEST.exists():
            for item in source.rglob("*"):
                if item.is_file() and (not (DEST / item.relative_to(source)).is_file() or
                    item.read_bytes() != (DEST / item.relative_to(source)).read_bytes()):
                    raise SystemExit("Installed W0 runtime differs; inspect before retry")
        else:
            DEST.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(source, DEST)
        print(run(str(DEST / "runsc"), "--version"))
        candidate_path = temp / "daemon.json"
        candidate_path.write_bytes(candidate)
        subprocess.run(["dockerd", "--validate", "--config-file", str(candidate_path)], check=True)
        if (config.read_bytes() if config.exists() else None) != original:
            raise SystemExit("daemon.json changed concurrently; stop")
        backup = config.with_name(f"daemon.json.agentanywhere-w0-{time.time_ns()}.bak")
        if original is not None:
            shutil.copy2(config, backup)
            print(f"Backup: {backup}")
        else:
            print("Original daemon.json absent; rollback must remove the new file")
        mode = config.stat().st_mode & 0o777 if config.exists() else 0o600
        config.parent.mkdir(parents=True, exist_ok=True)
        fd, staging = tempfile.mkstemp(prefix=".agentanywhere-", dir=config.parent)
        try:
            os.fchmod(fd, mode)
            with os.fdopen(fd, "wb") as stream:
                stream.write(candidate)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(staging, config)
        finally:
            if os.path.exists(staging):
                os.unlink(staging)
        subprocess.run(["systemctl", "reload", "docker"], check=True)
        for _ in range(20):
            runtimes = json.loads(run("docker", "info", "--format", "{{json .Runtimes}}"))
            if RUNTIME in runtimes:
                print("Runtime registered; sandbox compatibility remains unverified")
                return
            time.sleep(0.25)
        raise SystemExit("Runtime missing after reload; preserve backup and inspect Docker logs, never restart")


if __name__ == "__main__":
    main()
