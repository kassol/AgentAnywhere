#!/bin/bash
set -euo pipefail
test "$(id -u)" -ne 0
# Mount an x11vnc -storepasswd file; never publish the raw VNC port.
test -s /run/secrets/vnc-auth
pids=()
cleanup() {
  trap - EXIT
  if ((${#pids[@]})); then
    kill "${pids[@]}" 2>/dev/null || true
    wait "${pids[@]}" 2>/dev/null || true
  fi
}
trap cleanup EXIT
trap 'exit 143' TERM INT
Xvfb "$DISPLAY" -screen 0 1280x900x24 -nolisten tcp &
pids+=("$!")
for ((i=0; i<50; i++)); do
  if xdpyinfo >/dev/null 2>&1; then break; fi
  sleep 0.1
done
xdpyinfo >/dev/null
x11vnc -display "$DISPLAY" -localhost -rfbauth /run/secrets/vnc-auth \
  -forever -shared -rfbport 5900 > /evidence/vnc.log 2>&1 &
pids+=("$!")
websockify --web=/usr/share/novnc 0.0.0.0:6080 127.0.0.1:5900 \
  > /evidence/novnc.log 2>&1 &
pids+=("$!")
node /opt/browser/probe.mjs &
probe_pid=$!
pids+=("$probe_pid")
wait "$probe_pid"
