# Implementation Progress

> Tracked by agents across sessions. Read this first, update it last.
> See `ARCADE-FRONTEND-PLAN.md` for full specs.

## Current Phase: 5 — RPi Image
## Current Step: 1-9 + 12 done; sub 10 partial (real RPi 5 boot validated, kiosk runs); sub 11 pending
## Status: PARTIAL — distribution image build + WiFi captive portal still TODO

## Completed

### Phase 0 — Monorepo Setup (2026-04-17, merged into main)

- [x] 0.1 — 0.6 — see earlier revisions. 1145 tests pre-Phase 1.

### Phase 1 — Frontend Skeleton + Gamepad Nav (2026-04-17, merged into main)

- [x] 1.1 — 1.10 — see earlier revisions. 102 new Vitest cases + 5 E2E.

### Phase 2 — Game Loading + In-Game (2026-04-18, merged into main)

- [x] 2.1 — 2.9 — see earlier revisions. 107 new Vitest cases + 5 E2E.

### Phase 3 — ROM Transfer (WebRTC) + Phone Remote (2026-04-18, branch `feature/phase-3-webrtc-transfer`)

#### Week 1 — P2P foundation + basic transfer
- [x] 3.1 — `p2p/peer-deps.ts` centralises PeerJS import with a `window.__PeerMock` override hook.
- [x] 3.2 — `PeerHost` (kiosk) with per-connection reassembly + broadcast + event subscription (13 Vitest).
- [x] 3.3 — `PeerSend` (phone) with 16 KB chunking, bufferedAmount-based backpressure, one retry on transient send failure, progress callback (13 Vitest).
- [x] 3.4 — `RomPipeline` wires file identification + RomDB persistence, propagates typed errors (6 Vitest).
- [x] 3.5 — `/send/{roomId}` URL routing + `PhonePage` scaffold + 3 E2E specs including two-page BroadcastChannel mock that ships a test.zip through PeerJS and sees the host catalogue refresh.

#### Week 2 — Phone UI + remote control
- [x] 3.6 — `UploadTab` with file picker + drag-drop + FIFO queue + per-entry removal (17 Vitest + E2E).
- [x] 3.7 — `RemoteTab` with pause/resume/save/load/quit/volume + 4-slot save-slot picker + debounced volume (16 Vitest).
- [x] 3.8 — `QrCode` memoised canvas renderer encoding `https://sprixe.app/send/{roomId}` (8 Vitest).
- [x] 3.9 — `StateSync` diff-broadcast of kiosk snapshot to connected phones (8 Vitest, no-op when state unchanged).
- [x] 3.10 — `EmptyState` screen with prominent QR for first-boot; main.ts routes to it when RomDB is empty (unless localStorage `sprixe.useMockCatalogue=true`).

#### Week 3 — Polish + error handling
- [x] 3.11 — `classifyTransferError` maps every typed exception onto a UI-ready level + message (9 Vitest).
- [x] 3.12 — `sendFileWithReconnect` wraps any ResumableSender factory with one resume-on-drop retry (7 Vitest, E2E deliberately skipped for flakiness).
- [x] 3.13 — `Toast` component with capped queue (3), type-based durations (3/4/6 s), duplicate suppression, manual + auto dismissal (15 Vitest).
- [x] 3.14 — E2E `p3-phone-responsive` on iPhone 14 + Pixel 7 viewports — no horizontal scroll, every visible `<button>` ≥44×44 px (WCAG 2.5.5).

### Phase 3 totals

- Vitest: 322 tests / 26 files (+113 on top of Phase 2, grand total 1467 across all packages: 1002 engine + 143 edit + 322 frontend).
- E2E arcade: 19 tests — 4 Phase 1 + 6 Phase 2 + 9 Phase 3 (p3-rom-transfer-p2p ×3, p3-phone-upload, p3-empty-state, p3-phone-responsive ×2, plus helper updates).

### Phase 3 plan divergences

- Phase 3.11 E2E "send a .txt → error toast on host + phone" deferred to when main.ts mounts a Toast instance alongside PeerHost. The classifier is shipped; the wiring is a 5-line addition in Phase 4's polish.
- Phase 3.12 E2E deliberately skipped (plan explicitly allows it) — Vitest `sendFileWithReconnect` with a ResumableSender fake is the contract.
- RemoteTab UI → live DataConnection wiring deferred. PhonePage currently only mounts UploadTab; RemoteTab lives in `src/phone/` ready for Phase 4 to add the Upload/Remote tab switcher in PhonePage.
- Phone screen remote state-sync wiring (Phase 3.9 protocol) uses StateSync on the kiosk side but RemoteTab.setKioskState() isn't called by any live `state` message handler yet — same polish PR as above.

## Blocked / Notes

- `stage-sprixe/02-plymouth/files/logo.png` not committed — Phase 5 generates the boot logo.
- Default PeerJS Cloud signaling is reached by production PeerSend / PeerHost when `__PeerMock` is absent. Works on public networks; may be blocked on corporate VLANs (§6).
- Phase 2.9 save/load flow still not wired into PauseOverlay — onSaveState / onLoadState hooks exist but fire no-ops.

### Phase 4 — Polish + Settings (2026-04-18, branch `feature/phase-4-polish`)

- [x] 4.1 — `SettingsStore` versioned localStorage (13 Vitest).
- [x] 4.2 — `computeScale` + `isTateGame` + `crtFilterCss` render helpers (19 Vitest).
- [x] 4.3 — `parseScreenScraperResponse` CDN-upload helper (15 Vitest).
- [x] 4.4 — `MediaCache` + `PreviewLoader` + `scheduleVideoFade` (14 Vitest).
- [x] 4.5 — `History` recently-played + favorites (17 Vitest).
- [x] 4.6 — `LetterWheel` A-Z jump helper + overlay (18 Vitest).
- [x] 4.7 — `p4-animations` reduced-motion E2E contract (2 E2E).
- [x] 4.8 — `VolumeControl` pause-menu slider + mute memory (15 Vitest).

### Phase 4 totals

- Vitest: 435 tests / 33 files (+113 on top of Phase 3, grand total 1580 across all packages: 1002 engine + 143 edit + 435 frontend).
- E2E arcade: 19 tests (5 Phase 1 + 5 Phase 2 + 7 Phase 3 + 2 Phase 4).

### Phase 4 plan divergences

- Settings *screen* DOM (tabs for Display/Audio/Controls/Network/Storage/About) deferred to Phase 4.1b — the SettingsStore ships first so 4.2 + 4.8 have a persistence layer to read/write against.
- VideoPreview *DOM* not yet wired to PreviewLoader + scheduleVideoFade — Phase 4.4b in the same polish pass that wires RemoteTab into PhonePage.
- LetterWheel not yet opened from BrowserScreen — plan §2.4 maps it to RB which already cycles filters in §1.6; mapping decision deferred to Phase 4.6b (likely `favorite` / Y).
- VolumeControl slider not yet wired into PauseOverlay — `onSaveState` / `onLoadState` / volume hook land in Phase 4.8b alongside SaveStateDB integration (the two no-ops from Phase 2.9).
- Phase 4.3 E2E (`p4-video-preview` with `page.route('**/cdn/**')`) deferred — it requires the VideoPreview DOM wiring from 4.4b.
- Phase 4.8 E2E (`p4-volume-pause`) deferred — same reason (VolumeControl DOM not in PauseOverlay yet).

### Phase 4b — Polish wiring (2026-04-18, branch `feature/phase-4b-wiring`)

- [x] 4b.1 — Settings screen DOM (14 Vitest + E2E p4-settings-persistence).
- [x] 4b.2 — VideoPreview → PreviewLoader + IDB schema unification to v3. All three stores (roms/savestates/media) now land in whichever module opens the DB first.
- [x] 4b.3 — LetterWheel → BrowserScreen (Y button / 'favorite' NavAction) + E2E p4-letter-wheel.
- [x] 4b.4 — VolumeControl slider inside PauseOverlay (SettingsStore-backed) + E2E p4-volume-pause.
- [x] 4b.5 — PhonePage Upload/Remote tab switcher; RemoteTab.onCommand forwarded over the live data connection; host 'state' / 'volume' / 'save-slots' messages update RemoteTab in place.
- [x] 4b.6 — Toast mounted in bootKiosk; classifyTransferError wired on RomPipeline failures; 'complete' / 'error' protocol messages forwarded to the uploading phone + E2E p3-transfer-errors.

### Phase 4b totals

- Vitest: 449 tests / 34 files (+14 from the settings-screen unit suite).
- E2E arcade: 23 tests (+4 new — p4-settings-persistence, p4-letter-wheel, p4-volume-pause, p3-transfer-errors).
- Every Phase 4 module now has a consumer: SettingsStore / History / LetterWheel / PreviewLoader / VolumeControl / Toast.

### Phase 4b plan divergences

- ~~Settings tabs *Controls / Network / Storage* still not implemented.~~ Done in Phase 4b polish.
- ~~p4-video-preview E2E with `page.route('**/cdn/**')` deferred to 4b.2c — needs CDN fixture plumbing.~~ Done in Phase 4b polish (uses the dev server's own `/media` path with the `media-not-found-is-404` middleware instead of `page.route`).
- ~~SaveStateDB integration in PauseOverlay still fires no-ops — real emulator serialization needed first.~~ Done in Phase 4b polish via `SaveStateController` (mock emulator round-trips an 8-byte snapshot through `SaveStateDB.save/load`; real engine integration lands with Phase 5).
- ~~`__APP_VERSION__` injection for the About tab deferred (hard-coded to 'dev').~~ Done in Phase 4b polish via Vite `define`.

### Phase 4b polish (2026-04-18, branch `feature/phase-4b-polish`, merged)

- [x] `__APP_VERSION__` injected from `package.json` via Vite `define`; About tab consumes it.
- [x] `SaveStateController` glues `EmulatorHandle` ⇄ `SaveStateDB` ⇄ `Toast`. F5/F8 + Pause overlay 'Save State' / 'Load State' menu items both flow through it. MVP slot 0; the 4-slot picker UI moves to Phase 5 alongside the real engine.
- [x] SettingsScreen gains three tabs: Controls (current mapping + Reset → relaunch MappingScreen), Network (room id + signal + Regenerate room id), Storage (`navigator.storage.estimate()` + per-ROM delete). Bindings are optional so unit tests can mount the screen without mocking PeerHost / RomDB.
- [x] E2E `p4-video-preview` covers the screenshot blob upgrade and the 404 video fallback.

### Phase 4b polish totals

- Vitest: 461 tests / 35 files (+12 on top of Phase 4b — 7 SaveStateController, 8 SettingsScreen tabs, minus a flaky F5/F8 timer adjustment).
- E2E arcade: 25 tests (+2 — the two `p4-video-preview` cases).

### Phase 5 — RPi Image (2026-04-18, branches `feature/phase-5-image`, `fix/image-chromium-package`, `refactor/image-cage-wayland-direct`, all merged)

- [x] 5.12 — `p5-kiosk-simulation.spec.ts` under a new Playwright `kiosk` project that reproduces the on-device Chromium flags (`--kiosk --noerrdialogs --disable-translate --enable-features=SharedArrayBuffer --autoplay-policy=no-user-gesture-required`, viewport 1920×1080). Asserts `crossOriginIsolated === true`, `SharedArrayBuffer` defined, boot → play → quit flow, console clean (whitelist documented), URL stays on baseURL. 3/3 consecutive runs green.
- [x] 5.1–5.4 (consolidated) — `packages/sprixe-image/first-boot.sh`: provisions Chromium + cage + seatd, drops `~sprixe/start-kiosk.sh` (cage launcher), `~sprixe/.bash_profile` (auto-launch on tty1), autologin drop-in for sprixe, adds sprixe to video/render groups, enables seatd, trims unneeded services (avahi stays — mDNS is load-bearing for SSH). Idempotent via `/var/lib/sprixe-installed` marker.
- [x] 5.6 — boot config + cmdline tweaks **dropped** from this iteration. Cage handles KMS modesetting directly so the `hdmi_force_hotplug` / `hdmi_group=1 / hdmi_mode=16` chase that the Xorg pipeline made necessary became moot.
- [x] 5.8 — service trim collapsed into `first-boot.sh`. avahi explicitly preserved.
- [x] 5.9 — Makefile + scripts (verify-image / boot-test / flash) **removed** along with the pi-gen pivot. Replaced by `test-first-boot.sh` which smoke-tests `first-boot.sh` end-to-end inside a Debian arm64 container with mocked apt/systemctl/reboot.
- [x] 5.10 (partial) — manual hardware run on a real RPi 5: SSH ✅ autologin ✅ Wayland kiosk Chromium full-screen ✅ frontend chargeable from a Mac dev server ✅. Documented in README of `@sprixe/image`.
- [ ] 5.10 cont — automated systemd test on hardware (boot time, FPS, audio, gamepad).
- [ ] 5.11 — VideoCore VII / RPi 5 GPU specifics (real hardware).

### Phase 5 plan divergences

- **Pivoted away from pi-gen** entirely. On Apple Silicon + Docker Desktop the pi-gen pipeline cumulates three fragile layers (arm64 emulation, debootstrap chroot, an outdated `debian-archive-keyring` in the base Debian container) and each needs a workaround. Cleaner path: keep upstream RPi OS Lite intact, apply our overlay via `first-boot.sh`. A CI workflow on Linux x86_64 (where pi-gen runs cleanly) will produce the distribution `.img.xz` for non-technical users — out of scope for this branch.
- **Pivoted away from Xorg** entirely. The Xorg `modesetting` driver on RPi 5 + Bookworm/Trixie misreads the KMS pipeline (HDMI seen as "disconnected" even when the kernel sees it connected, Chromium ends up rendering at ~half the panel width because Xorg picks a fallback framebuffer geometry). Cage (a 500-line Wayland kiosk compositor) bypasses Xorg, lets Chromium use `--ozone-platform=wayland`, and the panel auto-detects at the right resolution.
- **Plymouth splash dropped from MVP** — re-introduce when we have the boot-time logo asset.
- **`sprixe-kiosk.service` + `sprixe-watchdog.service` + `.timer` dropped**. The auto-restart loop is "free" via the `.bash_profile` shell loop: when Chromium / cage exits, `exec` returns control to the autologin getty, which reclaims tty1 and re-runs `.bash_profile` → kiosk respawns. Less moving parts and one less surface that can stall the boot.
- **Raspberry Pi Imager has no native "Run script on first boot" field** (we initially planned to use it). Workflow corrected to: Imager flashes RPi OS Lite, user SSHes in, `scp first-boot.sh sprixe@sprixe.local:~/`, `sudo bash ~/first-boot.sh`. The CI-built `.img.xz` (TODO) collapses this back to a single Imager click for end users.

## Next Action

- **Hardware-side TODO** (next time the maintainer has a RPi 5 + SD on-hand): boot time profiling, real audio/gamepad regressions, distribution image build via CI Linux runner.
- **Frontend-side TODO**: `body { cursor: none }` rule on the kiosk route to hide the Wayland mouse cursor.
- **Deployment-side TODO**: Vercel project on `arcade.sprixe.dev` so the kiosk doesn't depend on a dev server. Until then, `start-kiosk.sh` points at `https://www.sprixe.dev/` (the landing).
- **Product-side TODO** (deferred): WiFi captive portal at first boot for plug-and-play setup.
