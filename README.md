# katana-control

Control a BOSS **KATANA Gen 3** amp from a PC over USB, without BOSS Tone Studio.

**Katana Studio** (`app/`, `katana-studio.exe`) is a touch-friendly replacement for Tone Studio:

- **Editor**: every patch parameter, grouped by block, with undo/redo and live sync with the amp.
- **Tones**: your library plus 50 read-only default tones (songs, genres, effects), A1/A2/B1/B2
  channel assignment, and import of Tone Studio `.tsl` liveset files.
- **AI Studio**: describe a tone; an LLM builds it on the amp, you play it, ask for changes, then save.
  It can read your tones and search the web. Bring your own key: OpenRouter (default), Anthropic, or
  any OpenAI-compatible server. Keys are stored on the device only.
- **Guitars**: per-guitar adjustments applied on the way to the amp.
- **Setlists**: map tones to channels per song and step through them live.

Run it with Tone Studio closed (on Windows a MIDI port can only be open in one program at a time).
It needs `WebView2Loader.dll` next to the exe. Tones, guitars and channel assignments are saved in
`%APPDATA%\app.katana-studio\`.

## Layout

- `crates/katana-core`: Roland SysEx, the parameter schema, the amp session, `.tsl` import.
- `crates/katana-cli`: `katana-control.exe`, a command-line tool (see below).
- `app/`: Tauri 2 backend and Svelte 5 UI. For UI work in a browser, `cd app/ui && npm install &&
  npm run dev`; outside Tauri it uses a mock amp.

The amp speaks Roland "exclusive" SysEx over USB MIDI, and its whole state is a flat address space:

```
F0 41 <dev> <model id x4> 12 <addr x4> <data...> <checksum> F7   DT1: write
F0 41 <dev> <model id x4> 11 <addr x4> <size x4> <checksum> F7   RQ1: read (amp answers with DT1)
```

`crates/katana-core/schema/katana-gen3.json` lists every patch parameter's address, range and encoding.

## Build

On Windows: install Rust from https://rustup.rs (MSVC toolchain), Node.js, then
`cd app/ui && npm install && npm run build` and `cargo build --release`.

On Linux, `./build-windows.sh` cross-compiles both exes for Windows with Zig as the linker (no sudo;
the one-time setup is in the script) and copies them to `dist/`. The CLI also builds and runs
natively on Linux (needs `libasound2-dev`).

## CLI

```
katana-control ports                      # list MIDI ports
katana-control identify                   # Identity Request: model/family/firmware
katana-control monitor --edit-mode        # print what the amp sends while you turn its knobs
katana-control read  "60 00 00 00" 32     # RQ1
katana-control write "60 00 06 51" "40"   # DT1
katana-control send  "F0 7E 7F 06 01 F7"  # raw bytes
katana-control decode capture.pcapng      # decode MIDI from a USB capture
katana-control tsl liveset.tsl            # list the tones in a .tsl file
```

Global flags: `--port <substring>` (default `katana`), `--device-id`, `--model-id`.

## License

[GNU Lesser General Public License v3.0 or later](COPYING.LESSER). The LGPL adds terms on top of
the [GNU GPL v3](COPYING), so both texts are included.
