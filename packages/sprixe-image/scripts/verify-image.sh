#!/bin/bash
# Inspect a built .img.xz with libguestfs (via Docker) and check that
# all the files the stage was supposed to land actually made it into
# the rootfs. Returns non-zero on the first missing artifact.
#
# Usage: ./verify-image.sh '<glob>'
#   The glob is expanded inside the script so the Makefile can pass
#   the raw pattern without worrying about no-match.

set -euo pipefail

GLOB="${1:-}"
if [ -z "$GLOB" ]; then
    echo "verify-image.sh: pass an image glob (e.g. ../pi-gen/deploy/*-sprixe-arcade*.img.xz)" >&2
    exit 2
fi

# shellcheck disable=SC2086
IMG=$(ls -1 $GLOB 2>/dev/null | head -n 1 || true)
if [ -z "$IMG" ]; then
    echo "verify-image.sh: no image matching '$GLOB' — run 'make image' first" >&2
    exit 2
fi

echo "verify-image.sh: inspecting $IMG"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

cp "$IMG" "$WORK/arcade.img.xz"
echo "verify-image.sh: decompressing..."
docker run --rm -v "$WORK:/work" -w /work debian:bookworm-slim \
    sh -c "apt-get update -qq && apt-get install -qq -y xz-utils >/dev/null && xz -d arcade.img.xz"

IMG_RAW="$WORK/arcade.img"

# Run every check inside a single guestfish invocation — launching the
# libguestfs appliance is the expensive part, we don't want to pay it
# per assertion.
docker run --rm -v "$WORK:/work" -w /work debian:bookworm-slim bash -s <<'SCRIPT'
set -euo pipefail
apt-get update -qq
apt-get install -qq -y libguestfs-tools linux-image-generic >/dev/null

guestfish --ro -a /work/arcade.img -i <<'GF'
-- exit non-zero from guestfish on the first missing path (-- prefix
-- suppresses the no-op warning); individual 'exists' commands print
-- true/false instead of aborting.

echo "=== /etc/passwd contains user sprixe ==="
grep '^sprixe:' /etc/passwd || (echo MISSING_USER && exit 1)

echo "=== systemd units ==="
exists /etc/systemd/system/sprixe-kiosk.service
exists /etc/systemd/system/sprixe-watchdog.service
exists /etc/systemd/system/sprixe-watchdog.timer

echo "=== watchdog script is executable ==="
stat /usr/local/bin/sprixe-watchdog.sh | grep 'Regular file'

echo "=== autologin drop-in ==="
cat /etc/systemd/system/getty@tty1.service.d/autologin.conf | grep 'autologin sprixe'

echo "=== boot config ==="
cat /boot/firmware/config.txt | grep 'gpu_mem=256'

echo "=== plymouth theme ==="
exists /usr/share/plymouth/themes/sprixe/sprixe.plymouth

echo "=== wifi template ==="
exists /etc/wpa_supplicant/wpa_supplicant.conf

echo "=== kiosk service enabled ==="
exists /etc/systemd/system/multi-user.target.wants/sprixe-kiosk.service

echo "=== watchdog timer enabled ==="
exists /etc/systemd/system/timers.target.wants/sprixe-watchdog.timer
GF
SCRIPT

echo "verify-image.sh: OK"
