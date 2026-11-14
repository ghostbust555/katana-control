# katana-control

**Katana Studio** (`app/`, `katana-studio.exe`): a touch-friendly replacement for BOSS Tone Studio
for the KATANA Gen 3. It has a tone editor with every patch parameter, a tone library with A1/A2/B1/B2
channel assignment, and per-guitar adjustments. Run it from the share (it needs `WebView2Loader.dll`
next to it), with Tone Studio closed. Tones, guitars and channel assignments are saved in
`%APPDATA%\app.katana-studio\`.

Layout: `crates/katana-core` (SysEx, schema, amp session), `crates/katana-cli` (`katana-control.exe`,
the command-line tool below), `app/` (Tauri 2 + Svelte UI). UI development in a browser:
`cd app/ui && npm run dev` (it uses a mock amp outside Tauri).

The parameter schema `crates/katana-core/schema/katana-gen3.json` lists every patch parameter's address, range and encoding.

Control a BOSS **Katana Gen 3** amp from a PC over USB without BOSS Tone Studio, by
learning the protocol Tone Studio speaks and replaying it.

Tone Studio talks to the amp with Roland "exclusive" SysEx over USB MIDI:

```
F0 41 <dev> <model id x4> 12 <addr x4> <data...> <checksum> F7   DT1: write
F0 41 <dev> <model id x4> 11 <addr x4> <size x4> <checksum> F7   RQ1: read (amp answers with DT1)
```

The whole amp state (patch, effects, knobs, system settings) is a flat address space.

## Build (Windows)

1. Install Rust from https://rustup.rs (pick the MSVC toolchain; it asks for VS Build Tools).
2. `cargo build --release` → `target\release\katana-control.exe`

Or cross-compile on Linux with `./build-windows.sh` (Zig as the linker, no sudo; one-time setup is
in the script). The result is a single `katana-control.exe` that needs only stock Windows DLLs.

It also builds and runs natively on Linux (needs `libasound2-dev`).

## Commands

```
katana-control ports                      # list MIDI ports
katana-control identify                   # Identity Request: confirms model/family/firmware
katana-control monitor --edit-mode        # print what the amp sends while you turn knobs on it
katana-control read  "60 00 00 00" 32     # RQ1
katana-control write "60 00 06 51" "40"   # DT1
katana-control send  "F0 7E 7F 06 01 F7"  # raw bytes
katana-control decode capture.pcapng      # decode a USB capture of Tone Studio
katana-control decode --summary capture.pcapng
```

Global flags: `--port <substring>` (default `katana`), `--device-id`, `--model-id`.
Defaults are the MkII values (`00`, `00 00 00 33`). **Confirm Gen 3's values first.**

Close Tone Studio before using the live commands. On Windows a MIDI port can only be open in
one program at a time.
