# @sprixe/image — RPi kiosk provisioner

Thin-client Raspberry Pi OS setup. The box boots straight into Chromium
in kiosk mode under cage (a minimal Wayland compositor) pointed at
`https://www.sprixe.dev/`. No local server, no Node.js, no ROMs bundled.

## How to flash an SD card

1. Install **Raspberry Pi Imager** (free, from raspberrypi.com or Homebrew).
2. Choose **Raspberry Pi OS Lite (64-bit)**. Targets RPi 5; should also
   work on RPi 4 with minor mileage.
3. Pick your target SD card (16 GB+, Class 10 / U1 / A1 minimum).
4. Click the gear icon (advanced settings):
   - Hostname: `sprixe`
   - Username: `sprixe` + pick a password
   - Wireless LAN: SSID + password (Ethernet works too — the first-boot
     script just needs *some* internet for `apt install`)
   - **Enable SSH** (you'll need it for the next step)
   - Locale: whatever suits
5. Click **Write**. ~3 minutes later the SD card is ready.
6. Insert the SD card in the Pi, plug HDMI + power.
7. Wait ~1 minute for the first boot. Then from your laptop:
   ```bash
   scp packages/sprixe-image/first-boot.sh sprixe@sprixe.local:~/
   ssh sprixe@sprixe.local
   sudo bash ~/first-boot.sh
   ```
   The script installs Chromium + cage + dependencies (~5–10 minutes
   silent), then reboots. From the **second boot** onward the Pi lands
   on the arcade in seconds.

> Note: Raspberry Pi Imager doesn't expose a "run script on first boot"
> field, hence the `scp` + `ssh` chain. A future workflow ships a
> pre-built `.img.xz` that has `first-boot.sh` already applied — that
> path is one Imager click for the end user.

## Updating a deployed Pi

Edit `/home/sprixe/start-kiosk.sh` (the cage launcher) over SSH, then
re-trigger the kiosk by switching VTs back to tty1 with
`sudo systemctl restart getty@tty1`. For a clean re-provision, delete
`/var/lib/sprixe-installed` and re-run `first-boot.sh`.

## What the script installs

- **chromium** + **cage** (Wayland kiosk compositor) + **seatd** (DRM
  access without root) + **fonts-noto-color-emoji**
- **mame** (apt) — the native emulator the bridge spawns for actual
  gameplay; Chromium handles the menu and ROM uploads.
- **nodejs** + **npm** + **git** — runtime and tooling for the bridge
  daemon below.
- `/opt/sprixe` — shallow clone of this repo. `npm install` + build
  produce the bridge's `dist/`. Future updates can `git pull` here
  rather than re-running this script.
- `/etc/systemd/system/sprixe-bridge.service` — runs `node
  /opt/sprixe/packages/sprixe-bridge/dist/index.js` on boot, restarts
  on failure, listens on `127.0.0.1:7777`.
- `/home/sprixe/sprixe-roms/` — staging dir the bridge writes ROMs to
  before passing them to MAME via `-rompath`.
- `/home/sprixe/start-kiosk.sh` — the cage launcher (Chromium flags +
  the arcade URL)
- `/home/sprixe/.bash_profile` — auto-launches the kiosk on tty1
- Autologin drop-in for `sprixe` on tty1
- Adds `sprixe` to the `video` and `render` groups (KMS access)
- Enables `seatd.service`, `avahi-daemon.service`, `sprixe-bridge.service`
- Disables: bluetooth, hciuart, ModemManager, apt-daily (shrinks boot
  time). Avahi is force-enabled (not just installed) because socket
  activation can lose the race against wpa_supplicant during a cold
  boot, leaving `sprixe.local` unresolvable.

### Provisioning from a feature branch

Default clones `main`. To test an unmerged branch:

```bash
ssh sprixe@sprixe.local
SPRIXE_BRANCH=feature/my-thing sudo -E bash ~/first-boot.sh
```

## Bridge architecture

The Pi runs Sprixe in two layers:

```
[cage + Chromium kiosk]  ←→  [Sprixe Frontend (browser)]  ←HTTP/SSE→  [bridge :7777]  ←spawn→  [MAME]
                                  menu, ROM upload, settings                   /tmp staging         fullscreen
```

When the user picks a game in the wheel, the frontend probes the
bridge at boot. If `:7777/health` answers, the ROM ZIP is POSTed to
`/launch` instead of being fed into the embedded TS engine — MAME
takes the screen, plays at full speed, and notifies the frontend via
SSE on `/events` when the user quits. If the bridge is missing (web
build, no Pi), the frontend falls back to its embedded TS emulator,
unchanged. Same UI, same code, same URL.

See `packages/sprixe-bridge/README.md` for the protocol details.

## Why cage and not Xorg

The Xorg modesetting driver on RPi 5 + Bookworm/Trixie has known
interop bugs with the KMS pipeline: HDMI gets reported "disconnected"
to Xorg even when the kernel sees it connected, and Chromium ends up
rendering at ~half the panel width because Xorg picks a fallback
framebuffer geometry. Cage is a 500-line Wayland compositor that does
exactly one thing: run a single client full-screen on whatever the
kernel exposes. By bypassing Xorg entirely, all those bugs evaporate
and the panel auto-detects at the right resolution.

## Why not pi-gen

An earlier iteration tried to ship a custom `.img.xz` built from
pi-gen so users could flash a single file. On Apple Silicon + Docker
Desktop that pipeline cumulates three fragile layers (arm64
emulation, debootstrap chroot, an outdated `debian-archive-keyring`
in the base Debian container) and each needs a workaround. The
Imager + provisioner workflow keeps the upstream RPi OS image intact
and applies the overlay on the first boot — no Docker, no sudo, no
silent failures during the build.

A CI workflow on a Linux x86_64 runner (where pi-gen runs cleanly)
will eventually produce a pre-built image for non-technical users —
that's the next iteration of this package.

## Smoke-testing `first-boot.sh` locally

Before flashing, you can validate the script end-to-end in an arm64
Docker container:

```bash
cd packages/sprixe-image
./test-first-boot.sh
```

It mocks `apt-get` / `systemctl` / `reboot`, runs `first-boot.sh`, then
asserts every expected file exists, `start-kiosk.sh` is executable
with the right cage launcher + Wayland ozone backend + `SharedArrayBuffer`
flag + arcade URL, the autologin drop-in points at `sprixe`, and the
`sprixe` user lands in `video` and `render`. Finishes in ~30 s on a
warm Docker cache. Needs Docker Desktop running; on Intel Macs / Linux
x86_64 it registers arm64 binfmt handlers automatically on first run.

## What's still TODO

Validated on real RPi 5 hardware as of this commit:
- ✅ RPi OS Lite 64-bit boots, SSH works, autologin, kiosk launches
- ✅ Cage + Wayland + Chromium runs full-screen at native HDMI resolution
- ✅ `apt`-installed Chromium accelerated via VideoCore

Open follow-ups (see also `BACKLOG.md`):
- Hide the mouse cursor — easiest fix is a `body { cursor: none }`
  rule in the frontend's `/play` route, no kiosk-side change needed.
- Deploy the arcade frontend to its own subdomain (`arcade.sprixe.dev`
  via Vercel) so the kiosk doesn't depend on a dev server. Until
  then, the script points at the landing page.
- Build the `.img.xz` distribution image in CI so non-technical users
  flash without an `ssh` step.
- WiFi captive portal at first boot for plug-and-play setup.
