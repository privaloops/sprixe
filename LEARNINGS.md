# Learnings

## Session April 18 — Phase 5 (RPi kiosk image)

### pi-gen on Apple Silicon is a dead end for fast iteration

**Context:** Initial Phase 5 plan built a custom RPi OS image with pi-gen so we could ship a single `.img.xz`. Three tries, three different failures on the same MacBook (Apple Silicon + Docker Desktop):

1. `setarch: failed to set personality to linux32: Invalid argument` — pi-gen's `master` branch defaults to armhf 32-bit; the linux32 personality isn't available under Docker Desktop's emulation. Fix: `PIGEN_BRANCH=arm64`.
2. `WARNING: armhf: not supported on this machine/kernel — emulated: ok` then `apt-get update` failing in stage0 with `NO_PUBKEY` for every Bookworm Debian signing key. Cause: the base Debian container pi-gen boots ships an older `debian-archive-keyring` that doesn't carry the current Bookworm keys, and the chroot can't fetch them because… signature check. Fix attempted: `tonistiigi/binfmt --install all` for binfmt handlers, then a `sed` patch on stage0 to add `Acquire::AllowInsecureRepositories=true` to the first `apt-get update`. Got further but still painful.
3. Even after the above, the build is 30–45 min per run, dies on transient mirror flakiness, leaves a `pigen_work` container that has to be pruned manually.

**Decision:** drop pi-gen for the maintainer-side workflow entirely. Use Raspberry Pi Imager (no build) + a `first-boot.sh` provisioner that runs once on the live Pi. The image build moves to a CI workflow on a Linux x86_64 runner (where pi-gen has none of these issues) and only ever runs in CI — local dev never touches it.

**Key insight:** the right test for "is this build pipeline OK" is "can the maintainer iterate on it on their own laptop in under 5 minutes". pi-gen on Apple Silicon fails that test by an order of magnitude.

### Xorg's modesetting driver on RPi 5 + Bookworm is broken; use cage

**Context:** First-boot script provisioned chromium under Xorg via the classic `autologin → .bash_profile → startx → .xinitrc` chain. Boot worked, Chromium launched in `--kiosk`, but rendered at roughly half the panel width — the rest of the 1920×1080 screen was black.

**Investigation on the live Pi:**
- `xrandr` reported both HDMI outputs as `disconnected` even though `/sys/class/drm/*-HDMI*/status` said `connected` and the kernel was happily emitting 1920×1080 modes.
- `vcgencmd get_config int | grep -i hdmi` showed our `hdmi_group=1 hdmi_mode=16 disable_overscan=1` from `config.txt` were being **silently ignored** by the firmware on RPi 5 (the legacy KMS variables don't apply to bcm2712).
- Kernel `video=HDMI-A-1:1920x1080@60` in `cmdline.txt`, `xrandr --fb 1920x1080`, `--force-device-scale-factor=1`, `--window-size=1920,1080` — none of them moved the rendering.

**Root cause:** Xorg's `modesetting` driver doesn't talk to the bcm2712 KMS pipeline correctly. It picks a fallback framebuffer geometry that doesn't match the panel's native, and Chromium follows whatever Xorg gives it.

**Fix:** swap Xorg for **cage** (~500-line Wayland kiosk compositor). Chromium with `--ozone-platform=wayland` talks Wayland directly, cage hands it the panel exactly as KMS exposes it, and full-screen at native resolution Just Works on the first try.

**Key insight:** when the diagnostic from a tool is "the thing the kernel sees as connected, I see as disconnected", you've crossed the boundary where you should stop fixing the tool and replace it. On RPi 5 + Bookworm/Trixie, that boundary is reached the moment Xorg starts.

### Raspberry Pi Imager has no "Run custom script on first boot" field

**Context:** The Phase 5 user story I wrote assumed the user would paste `first-boot.sh` into a "Run custom script on first boot" field in Raspberry Pi Imager and the SD would be ready to go. The field doesn't exist. The Imager handles hostname / user / WiFi / SSH via its own `firstrun.sh`, but doesn't expose a hook for arbitrary scripts.

**Decision:** the maintainer workflow becomes a 3-line follow-up after flashing — `scp first-boot.sh sprixe@sprixe.local:~/` then `ssh sprixe@sprixe.local && sudo bash ~/first-boot.sh`. For end users, the same `first-boot.sh` ends up baked into a CI-built `.img.xz` so they only ever click Imager once.

**Key insight:** I asserted a feature into existence to fit a story I'd already drafted. Always cross-check feature claims against the actual UI before writing onboarding docs — and especially before promising "five steps in a GUI" as a contrast point.

### avahi-daemon is load-bearing for `*.local` mDNS — never auto-disable it on a kiosk

**Context:** First-boot.sh disabled a list of services to shrink boot time on the appliance. avahi-daemon was on that list ("looks irrelevant for a kiosk"). Result: after the first reboot, `ssh sprixe@sprixe.local` started returning host-not-found, the maintainer had to dig the IP out of `arp -a` to recover.

**Fix:** keep avahi enabled. The 1–2 services we're saving doesn't matter against the catastrophic UX cost of "you can't SSH in to debug your appliance any more".

**Key insight:** "trim services" lists in kiosk tutorials are written for hardware that's been flashed-and-forgotten. A maintainer's appliance is also a development target until it isn't — keep the SSH-side tooling (mDNS, getty, etc.) until you really have someone to ship to.

## Session April 15

### Neo-Geo sprite X position — MAME comparison reveals three bugs

**Context:** fatfury1 sprites disappeared intermittently, especially when moving backward.

**Root cause:** Three differences with MAME's sprite X handling:
1. **Signed conversion threshold**: we used `>= 0x1E0` (−32), MAME uses `> 0x1F0` (−15). Values in `0x1E0..0x1F0` are valid on-screen X positions that we were converting to negative → sprites rendered off-screen.
2. **Sticky chain X mask**: MAME masks sticky X to 9 bits (`& 0x1FF`). We didn't mask → X overflowed 9-bit range after many chained sprites.
3. **Off-screen skip**: MAME skips sprites with X in `[0x140, 0x1F0]` (gap between right edge and left wrap). We had no equivalent → rendered invisible sprites at wrong positions.

**Key insight:** The Neo-Geo uses 9-bit unsigned X coordinates (0-511). Values 0-319 are visible, 320-496 are off-screen right/gap, 497-511 wrap to the left of screen. Never do signed conversion in the forward pass — keep unsigned, convert only at blit time.

### Neo-Geo ADPCM-B silence — shared V-ROM pool offset bug

**Context:** fatfury1 (and all early Neo-Geo games with a single V-ROM) had audio in menus but total silence when a fight started. blazstar, mslug2, mslug3 also affected.

**Root cause:** The YM2610 WASM wrapper (`ym2610_wrapper.cpp`) offsets ADPCM-B reads by `adpcm_a_size`. For games with split pools (separate ADPCM-A/B ROMs), this is correct. But for games with a single V-ROM, `assembleVoiceRom` sets `adpcmASize = totalSize` (the entire ROM). ADPCM-B reads at address X went to `totalSize + X` — past the buffer — returning 0 (silence).

**Why menus worked:** Menu music/SFX used ADPCM-A channels (short samples). Fight BGM used ADPCM-B (longer samples for music playback). Both share the same ROM data on early Neo-Geo hardware.

**Fix:** In `ymfm_external_read`, when `adpcm_a_size >= combined_rom_size` (no split), ADPCM-B reads at `address % combined_rom_size` instead of `adpcm_a_size + address`.

**Key insight:** Neo-Geo ADPCM-A and ADPCM-B address spaces are independent on the YM2610. When MAME has a single `ymsnd` region, both A and B read from the same ROM with no offset. Our wrapper must mirror this.

## Session April 14

### Neo-Geo CMC fix layer — three layers of bugs

**Context:** CMC-encrypted games (garou, kof99, mslug3) had no HUD. The fix layer was blank or garbled.

**Root cause 1 — empty buffer:** CMC games have no `fixed:` in their game def (S-ROM is embedded in C-ROM). The ROM loader returns `Uint8Array(0)`. `cmcSfixDecrypt` loops 0 times → no data.

**Root cause 2 — wrong extraction size:** The S-ROM size varies per game (kof99=128KB, garou/mslug3=512KB). Hardcoding 128KB reads from the wrong C-ROM offset for 512KB games — you get the last quarter of the sfix region instead of the full thing. MAME `neogeo.xml` has authoritative sizes per game.

**Root cause 3 — no fix layer banking:** The LSPC2 VRAM tile code is 12 bits (4096 tiles = 128KB). Games with 512KB S-ROM use banking via VRAM $7500-$75BF. Two schemes exist: Garou type (per-row sticky bank) and KOF2000 type (per-tile, 6 tiles per VRAM word). The 2-bit bank is XOR'd with 3 (inverted) and extends the tile code to 14 bits.

**Key insight — MAME sfix_table vs sfix_decrypt:** MAME has TWO sfix functions. `sfix_table` (a 32-byte LUT in `neogeo_cmc.cpp`) is for the older `neogeo_sfix_decrypt`. The actual `prot_cmc.cpp::sfix_decrypt` uses an arithmetic formula identical to FBNeo's `NeoCMCExtractSData`. Using the LUT instead of the formula produces wrong byte ordering.

**Key insight — FBNeo NeoDecodeText:** FBNeo applies `NeoDecodeText` (byte reorder + nibble swap) to ALL S-ROM data during loading, converting from hardware column-major to FBNeo's internal format. Our `decodeFixRow` handles column-major directly at render time, so we must NOT apply this conversion — just the raw extraction formula.

## Session April 3

### Pose deduplication — two independent bugs causing duplicates

**Context:** Same pose appeared multiple times in sprite sheet exports (e.g., sf2hf captured 80 poses but 18 groups were duplicates).

**Root cause 1 — inconsistent hash formulas:** Three dedup sites (stop-time, export, save restore) used `[...new Set(codes)].sort().join(',')` which strips intra-group duplicate tile codes, while `poseHash()` (frame-time) preserves them. The formulas could disagree on what constitutes a duplicate.

**Fix:** All sites now use `p.tileHash` / `pose.tileHash` (pre-computed by `poseHash()`). Single source of truth.

**Root cause 2 — multi-palette grouping pollution:** `groupCharacter()` flood-fills across palettes (body + weapon + horse share adjacency). `poseHash()` hashed ALL tiles including adjacent sprites from other palettes. If a nearby sprite from another palette entered/left the adjacency zone between frames, the hash changed, creating false-distinct poses.

**Fix:** `poseHash()` now filters `group.tiles` by `group.palette` before hashing. Adjacent tiles from other palettes are irrelevant to pose identity.

**Key insight:** CPS1 characters are multi-palette by design, but pose identity should be per-palette. Since Aseprite is strictly one palette per indexed file (no per-layer/per-tile palette), multi-palette grouping was carrying dead weight. The solution is mono-palette grouping at capture time — simpler, cleaner, and eliminates a whole class of parasites.

## Session April 2-3

### CPS1 multi-tile sprites — why captures were broken for complex games

**Context:** Sprite capture worked for Final Fight but tiles were misplaced for WoF (Warriors of Fate) in the sprite sheet viewer and layer panel.

**Root cause:** `readAllSprites()` treated each OBJ entry as a single 16×16 tile, but CPS1 hardware supports multi-tile (nx×ny) sprites. A single OBJ entry can generate a grid of tiles (e.g., 4×4 = 16 tiles). The renderer (`cps1-video.ts`) correctly expanded these, but the sprite analyzer didn't.

**Fix:** Replicate the renderer's sub-tile expansion formula: `(mappedBaseCode & ~0x0F) + ((mappedBaseCode + nxs) & 0x0F) + 0x10 * nys` with flip variants. Each sub-tile gets a unique `uid` for grouping deduplication (multiple sub-tiles share the same OBJ `index`).

**Key insight:** The tile code formula is duplicated between `cps1-video.ts` and `sprite-analyzer.ts`. A comment marks this dependency. If the formula changes, both must be updated.

### Per-palette export — why multi-palette import is fundamentally impossible

**Context:** CPS1 tiles are 4bpp indexed with a single 16-color palette per tile. A character spanning multiple palettes (e.g., rider + horse in WoF) cannot be imported as a single Aseprite file because Aseprite uses one palette per frame.

**Decision:** Export per palette instead of per character. Each exported .aseprite file is mono-palette and independently importable. The eye toggle in the sprite palette panel lets users isolate which palette to capture/export.

## Session March 25 (evening)

### FM Patch Editor — Why real-time playback failed

**Context:** Attempted to make FM parameter edits (algorithm, ADSR, volume) audible immediately while the game plays.

**Approaches tried:**
1. **ROM patching only** (`syncAudioRom`) — Z80 caches voice data in work RAM. Only takes effect when the Z80 reloads the voice from ROM (rare, driven by music data). No immediate effect.
2. **Direct WASM writes** (`fmOverride`) — Writes YM2151 registers directly. Works momentarily but Z80 overwrites them on the next frame (continuous TL adjustments for volume envelopes). Also corrupts the WASM address latch between Z80 ticks (Nuked OPM is cycle-accurate; `writeAddress` without intervening `clockCycles` breaks internal state).
3. **Z80 write interception** (`fmEditorActive` + shadow registers) — Intercepts Z80 register writes and substitutes editor values. Race condition: lock message arrives before register data → zeros written → silence. Fixed with atomic message, but TL interception removes Z80 volume dynamics → notes play flat with no velocity/envelope. Excluding TL from interception preserves dynamics but means Volume/Brightness sliders have no effect.

**Root cause:** The Z80 sound driver has two layers of control:
- **Voice loading** (infrequent): reads 40-byte voice from ROM → writes all YM2151 registers
- **Volume envelope** (every frame): adjusts carrier TL = base_TL + channel_volume_offset

These two layers are inseparable without understanding the music sequence format. Any override that touches TL conflicts with the driver's volume control.

**Conclusion:** Real-time FM preview requires reverse-engineering the Z80 music sequencer to either:
- Inject modified voice data into the Z80's work RAM channel state
- Or replace the driver's voice loading routine with a hook

### CPS1 Palette — Brightness fade discovery

**Context:** Palette edits in VRAM weren't persisting across rounds. Attempted to find palette data in program ROM by searching for exact 32-byte VRAM patterns.

**Problem:** Zero matches in 2MB program ROM, even for 8-byte partial matches, even byte-swapped.

**Discovery:** Palette watch trace revealed the 68K runs `ADD.W D2, (A0)+` (opcode 0xD558) in a loop at PC=0x2A6A-0x2A70, adding 0x1000 to each palette word. This is a **brightness fade-in**: CPS1 palette format has brightness in bits 15-12, so +0x1000 = +1 brightness step.

**Solution:** Strip the brightness nibble (bits 15-12) from VRAM values before searching program ROM. The base palette (brightness=0) exists in ROM. When patching, preserve the ROM's original brightness nibble and replace only the RGB nibbles (bits 11-0).

**Key insight:** CPS1 games rarely store final VRAM-ready palette values in ROM. They store base palettes and apply runtime transformations (brightness fades, color cycling, flash effects). Any palette search must account for this.

### Nuked OPM WASM — Address latch sensitivity

**Context:** Adding `ym2151.writeAddress(register)` before every `writeData()` in the Z80 callback killed all audio.

**Cause:** Nuked OPM is cycle-accurate. `OPM_Write(&chip, 0, value)` schedules an address latch update that needs `OPM_Clock()` cycles to process. Calling `writeAddress` twice without intervening clock cycles (once from the Z80's port 0xF000 write, once from our added call) corrupts the chip's internal write-pending state.

**Rule:** Never call `writeAddress`/`writeData` on Nuked OPM without `clockCycles()` between them. The Z80 naturally provides cycles between address and data writes; external code (fmOverride) must explicitly clock.

### Scroll 2 tile inspector — Row scroll offset

**Context:** Clicking on scroll 2 tiles selected wrong tiles on stages with parallax (Ken, Honda, etc.).

**Cause:** The render path applies per-row X scroll offsets for scroll 2 (when videocontrol bit 0 is set), but `inspectScrollAt` used a single fixed scroll X for all rows.

**Fix:** Replicated the render path's row scroll formula in `inspectScrollAt`: read per-row offset from VRAM "other" region, apply to scroll X before coordinate mapping.
