#!/bin/bash
# Fired every 30s by sprixe-watchdog.timer (see the .timer unit). If
# the kiosk service is dead — Chromium crashed, cage segfaulted, OOM,
# whatever — systemd's own Restart=always handles the first N
# attempts; this watchdog is the last line for the case where the
# unit ends up in the "failed" state after exhausting its restart
# budget, which would otherwise leave a dark TV until a human power-
# cycles the box.

set -eu

UNIT=sprixe-kiosk.service

if systemctl is-failed --quiet "${UNIT}"; then
    logger -t sprixe-watchdog "${UNIT} is failed — resetting and restarting"
    systemctl reset-failed "${UNIT}"
    systemctl restart "${UNIT}"
elif ! systemctl is-active --quiet "${UNIT}"; then
    logger -t sprixe-watchdog "${UNIT} is inactive — starting"
    systemctl start "${UNIT}"
fi
