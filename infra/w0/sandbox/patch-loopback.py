#!/usr/bin/env python3
"""Apply the W0 loopback-only patch to a clean, pinned OpenSandbox checkout."""
from pathlib import Path
import subprocess
import sys

COMMIT = "c39b814f36ded4c61d5ac6f9332ee4dfbab86c00"
PATCHES = {
    "server/opensandbox_server/services/docker/port_allocator.py": [
        ('DOCKER_PUBLISH_HOST = "0.0.0.0"', 'DOCKER_PUBLISH_HOST = "127.0.0.1"'),
    ],
    "server/opensandbox_server/services/docker/networking.py": [
        ('"44772": ("0.0.0.0", host_execd_port)', '"44772": ("127.0.0.1", host_execd_port)'),
        ('"8080": ("0.0.0.0", host_http_port)', '"8080": ("127.0.0.1", host_http_port)'),
    ],
}


def patched(text, replacements):
    for old, new in replacements:
        if text.count(old) != 1:
            raise ValueError(f"Expected exactly one upstream match: {old}")
        text = text.replace(old, new, 1)
    return text


def main():
    root = Path(sys.argv[1]).resolve()
    actual = subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip()
    if actual != COMMIT:
        raise SystemExit("Wrong OpenSandbox commit")
    if subprocess.check_output(["git", "-C", str(root), "status", "--porcelain"], text=True):
        raise SystemExit("Checkout must be clean; preserve existing changes")
    edits = [(root / path, patched((root / path).read_text(), replacements))
             for path, replacements in PATCHES.items()]
    for path, content in edits:
        path.write_text(content)
    print("Applied three loopback replacements; runtime verification remains pending")


if __name__ == "__main__":
    main()
