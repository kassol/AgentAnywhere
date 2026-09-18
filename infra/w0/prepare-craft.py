"""Prepare the pinned OSS checkout for W0; pin its CLI types without changing resolved dependencies."""
from pathlib import Path
import sys

root = Path(sys.argv[1])
# Pin the CLI's floating declaration to its existing resolved version.
manifest = root / 'apps/cli/package.json'
lock = root / 'bun.lock'
old = '"@types/bun": "latest"'
new = '"@types/bun": "1.4.1"'
manifest_text = manifest.read_text()
lock_text = lock.read_text()
assert '"@craft-agent/cli/@types/bun": ["@types/bun@1.4.1"' in lock_text
start = lock_text.index('    "apps/cli": {')
end = lock_text.index('    "apps/electron": {', start)
section = lock_text[start:end]
assert manifest_text.count(old) == 1 and section.count(old) == 1
text = (root / 'Dockerfile.server').read_text()
for path in ('packages/craft-agents-commands', 'packages/craft-cli', 'apps/marketing', 'apps/docs-site'):
    line = f'COPY {path}/package.json {path}/\n'
    assert line in text and not (root / path / 'package.json').exists(), path
    text = text.replace(line, '')
base = 'FROM oven/bun:1.3-slim'
assert base in text
text = text.replace(base, 'FROM oven/bun@sha256:5d5863f35ad9b3acceee8dc134fb2b89f07831129eaeec81af2b19a23dabe3e0')
manifest.write_text(manifest_text.replace(old, new))
lock.write_text(lock_text[:start] + section.replace(old, new) + lock_text[end:])
print('# W0 adaptation: remove four COPY entries absent from the pinned OSS export; pin Bun image.\n' + text, end='')
