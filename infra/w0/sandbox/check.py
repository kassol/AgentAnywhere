#!/usr/bin/env python3
"""Local checks: no Docker, SSH, network, or system configuration writes."""
import importlib.util
import json
from pathlib import Path


def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


runtime = load("install-runtime")
original = {"default-runtime": "runc", "runtimes": {"custom": {"path": "/old"}}, "log-level": "warn"}
result = json.loads(runtime.merge_runtime(json.dumps(original).encode()))
assert result.pop("runtimes") == {**original["runtimes"], runtime.RUNTIME: runtime.ENTRY}
assert result == {key: value for key, value in original.items() if key != "runtimes"}
assert json.loads(runtime.merge_runtime(b""))["runtimes"][runtime.RUNTIME] == runtime.ENTRY
try:
    runtime.merge_runtime(json.dumps({"runtimes": {runtime.RUNTIME: {"path": "/other"}}}).encode())
except ValueError:
    pass
else:
    raise AssertionError("Conflicting runtime must not be overwritten")
patch = load("patch-loopback")
for replacements in patch.PATCHES.values():
    source = "\n".join(old for old, _ in replacements)
    assert patch.patched(source, replacements) == "\n".join(new for _, new in replacements)
    try:
        patch.patched(source + "\n" + source, replacements)
    except ValueError:
        pass
    else:
        raise AssertionError("Ambiguous upstream patch must fail")
print("PASS: runtime merge preserves existing options; patch rejects drift")
