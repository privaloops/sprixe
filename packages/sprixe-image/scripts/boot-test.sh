#!/bin/bash
# Smoke-boot the image in QEMU so a broken rootfs (missing kernel,
# bogus systemd unit, corrupt fstab) fails in CI before a single SD
# card is flashed.
#
# **Honest scope**: QEMU upstream doesn't model bcm2712 (RPi 5) yet.
# We boot under -M raspi4b, which is close enough to catch userspace
# regressions (systemd targets, autologin, service state). GPU /
# VideoCore VII specifics are validated on real hardware only.
#
# Usage: ./boot-test.sh '<glob>'

set -euo pipefail

GLOB="${1:-}"
if [ -z "$GLOB" ]; then
    echo "boot-test.sh: pass an image glob" >&2
    exit 2
fi

# shellcheck disable=SC2086
IMG=$(ls -1 $GLOB 2>/dev/null | head -n 1 || true)
if [ -z "$IMG" ]; then
    echo "boot-test.sh: no image matching '$GLOB' — run 'make image' first" >&2
    exit 2
fi

echo "boot-test.sh: booting $IMG in QEMU (raspi4b approx)"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

cp "$IMG" "$WORK/arcade.img.xz"

# Decompress + extract kernel + dtb from the boot partition. We pipe
# everything through a single container so nothing persists on the host.
docker run --rm -v "$WORK:/work" -w /work debian:bookworm-slim bash -s <<'PREP'
set -euo pipefail
apt-get update -qq
apt-get install -qq -y xz-utils libguestfs-tools linux-image-generic >/dev/null

xz -d arcade.img.xz

mkdir -p kernel
guestfish --ro -a arcade.img <<'GF'
run
mount /dev/sda1 /
copy-out /kernel8.img /work/kernel/
copy-out /bcm2710-rpi-4-b.dtb /work/kernel/
umount-all
GF
PREP

# Grow the image to a round size — QEMU wants a power-of-two rootfs
# and pi-gen leaves a tight fit that makes the loop mount unhappy.
qemu-img resize -f raw "$WORK/arcade.img" 8G

# 5-min ceiling: if the boot flow hasn't produced a login prompt by
# then something is very wrong. -nographic + -serial stdio pipes the
# kernel console here so we can grep the output for boot markers.
timeout 300 docker run --rm -v "$WORK:/work" -w /work \
    --platform linux/arm64 tianon/qemu:latest \
    qemu-system-aarch64 \
      -M raspi4b -m 2G -smp 4 \
      -kernel /work/kernel/kernel8.img \
      -dtb /work/kernel/bcm2710-rpi-4-b.dtb \
      -drive file=/work/arcade.img,format=raw,if=sd \
      -serial stdio -display none -nographic \
      -append "console=ttyAMA0,115200 root=/dev/mmcblk0p2 rootfstype=ext4 rootwait" \
    | tee "$WORK/boot.log" | grep --line-buffered -q 'Reached target Multi-User System' && echo "boot-test.sh: OK"
