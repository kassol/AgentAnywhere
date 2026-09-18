#!/usr/bin/env python3
"""Run on cc-la after installation. Requires OPEN_SANDBOX_API_KEY; prints no key."""
import asyncio
from datetime import timedelta
import hashlib
import json
import os
from pathlib import Path
import subprocess

from opensandbox.config import ConnectionConfig
from opensandbox.models.filesystem import WriteEntry
from opensandbox.sandbox import Sandbox


def containers(sandbox_id):
    return subprocess.check_output(
        ["docker", "ps", "-aq", "--filter", f"label=opensandbox.io/id={sandbox_id}"],
        text=True,
    ).split()


async def main():
    config = ConnectionConfig(domain="127.0.0.1:19310", api_key=os.environ["OPEN_SANDBOX_API_KEY"])
    image = os.environ["W0_SANDBOX_IMAGE"]
    if "@sha256:" not in image:
        raise ValueError("W0_SANDBOX_IMAGE must contain a resolved image digest")
    sandbox = await Sandbox.create(image, connection_config=config,
                                   timeout=timedelta(minutes=5),
                                   resource={"cpu": "1", "memory": "512Mi"},
                                   metadata={"project": "agentanywhere-w0"})
    print("sandbox_id=" + sandbox.id)
    output = Path("/opt/agentanywhere-w0/evidence/sandbox-artifact.txt")
    try:
        ids = containers(sandbox.id)
        assert len(ids) == 1, ids
        data = json.loads(subprocess.check_output(["docker", "inspect", ids[0]], text=True))[0]
        assert data["HostConfig"]["Runtime"] == "agentanywhere-w0-runsc"
        bindings = data["HostConfig"]["PortBindings"]
        assert bindings and all(b["HostIp"] == "127.0.0.1" for items in bindings.values() for b in items)
        result = await sandbox.commands.run("printf agentanywhere-w0")
        assert "".join(item.text for item in result.logs.stdout) == "agentanywhere-w0"
        expected = "W0 artifact survives sandbox destruction\n"
        await sandbox.files.write_files([WriteEntry(path="/tmp/w0.txt", data=expected, mode=644)])
        actual = await sandbox.files.read_file("/tmp/w0.txt")
        assert actual == expected
        info = await sandbox.get_info()
        assert info.status.state == "Running", info.status.state
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(actual)
        checksum = hashlib.sha256(output.read_bytes()).hexdigest()
    finally:
        await sandbox.destroy()
    assert not containers(sandbox.id), "Sandbox container remains after destroy"
    assert hashlib.sha256(output.read_bytes()).hexdigest() == checksum
    print("PASS: runtime, loopback bindings, command, file, status, destroy, retained artifact")


if __name__ == "__main__":
    asyncio.run(main())
