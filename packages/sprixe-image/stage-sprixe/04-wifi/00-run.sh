#!/bin/bash -e
# Seed /etc/wpa_supplicant/wpa_supplicant.conf with a template the user
# edits before flashing — or the first-boot setup flow replaces at
# runtime. Shipping the file pre-created lets wpa_supplicant-wlan0
# autostart on first boot as soon as the SSID/PSK lines are filled in.

install -d "${ROOTFS_DIR}/etc/wpa_supplicant"
install -m 600 files/wpa_supplicant.conf.template \
  "${ROOTFS_DIR}/etc/wpa_supplicant/wpa_supplicant.conf"

on_chroot <<EOF
# wpa_supplicant-wlan0 watches the conf above and brings up the
# interface. systemd-networkd is already enabled upstream by pi-gen.
systemctl enable wpa_supplicant@wlan0.service || true
EOF
