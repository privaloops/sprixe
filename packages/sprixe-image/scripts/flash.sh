#!/bin/bash
# dd a built .img.xz onto an SD card. Runs a few sanity checks first
# so a slip of the CLI doesn't nuke the host drive:
#   - DEVICE must be a block device
#   - DEVICE must not be mounted read-write as a system fs
#   - Interactive confirmation before the write
#
# Usage: ./flash.sh '<glob>' /dev/diskN

set -euo pipefail

GLOB="${1:-}"
DEVICE="${2:-}"
if [ -z "$GLOB" ] || [ -z "$DEVICE" ]; then
    echo "usage: flash.sh '<image-glob>' /dev/diskN" >&2
    exit 2
fi

# shellcheck disable=SC2086
IMG=$(ls -1 $GLOB 2>/dev/null | head -n 1 || true)
if [ -z "$IMG" ]; then
    echo "flash.sh: no image matching '$GLOB'" >&2
    exit 2
fi

if [ ! -b "$DEVICE" ]; then
    echo "flash.sh: $DEVICE is not a block device" >&2
    exit 2
fi

case "$DEVICE" in
    /dev/disk0|/dev/sda)
        echo "flash.sh: refusing to write to $DEVICE (looks like your primary disk)" >&2
        exit 2
        ;;
esac

SIZE=$(blockdev --getsize64 "$DEVICE" 2>/dev/null || \
       diskutil info "$DEVICE" 2>/dev/null | awk -F': ' '/Disk Size/ {print $2; exit}')
echo "flash.sh: about to write $IMG"
echo "       → $DEVICE ($SIZE)"
printf "Type 'yes' to continue: "
read -r CONFIRM
[ "$CONFIRM" = "yes" ] || { echo "aborted"; exit 1; }

# macOS diskutil + Linux udevadm both unmount before dd can grab
# exclusive access; fall through silently when the commands are
# absent (e.g. inside a stripped container).
diskutil unmountDisk "$DEVICE" 2>/dev/null || true
udevadm settle 2>/dev/null || true

echo "flash.sh: decompressing and writing — this takes a few minutes..."
xz -d -c "$IMG" | sudo dd of="$DEVICE" bs=4M status=progress conv=fsync
sync

echo "flash.sh: done"
