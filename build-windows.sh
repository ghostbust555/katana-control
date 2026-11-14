#!/usr/bin/env bash
# Cross-compile katana-control.exe (CLI) and katana-studio.exe (app) on Linux, no sudo needed.
# One-time setup:
#   python3 -m venv ~/.local/share/ziglang-venv && ~/.local/share/ziglang-venv/bin/pip install ziglang
#   cargo install cargo-zigbuild && rustup target add x86_64-pc-windows-gnu
#   (cd app/ui && npm install)
#   Tauri's resource step needs windres: unpack it from the Debian package into ~/.local/mingw
#     (cd /tmp && apt-get download binutils-mingw-w64-x86-64 && dpkg -x binutils-mingw-w64-x86-64_*.deb ~/.local/mingw)
#     mkdir -p ~/.local/mingw/bin && ln -sf ~/.local/mingw/usr/bin/x86_64-w64-mingw32-windres ~/.local/mingw/bin/
#   and give it Zig as its preprocessor: ~/.local/mingw/bin/x86_64-w64-mingw32-gcc =
#     #!/bin/sh
#     exec "$HOME/.local/share/ziglang-venv/bin/python-zig" cc -target x86_64-windows-gnu "$@"
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.local/mingw/bin:$HOME/.local/share/ziglang-venv/bin:$PATH"
(cd app/ui && npm run build --silent)
cargo zigbuild --release --target x86_64-pc-windows-gnu -p katana-cli -p katana-app

# Publish to dist/ (e.g. share that folder on the LAN to run the exes on a Windows PC).
# Copy then rename, so a Windows client never sees a half-written file.
out=target/x86_64-pc-windows-gnu/release
mkdir -p dist
for f in katana-control.exe katana-studio.exe WebView2Loader.dll; do
    cp "$out/$f" "dist/.$f.tmp" && mv "dist/.$f.tmp" "dist/$f"
done
echo "published katana-control.exe, katana-studio.exe (+ WebView2Loader.dll) -> dist/"
