#!/usr/bin/env bash
# Cross-compile katana-control.exe on Linux (no sudo needed).
# One-time setup:
#   python3 -m venv ~/.local/share/ziglang-venv && ~/.local/share/ziglang-venv/bin/pip install ziglang
#   cargo install cargo-zigbuild
#   rustup target add x86_64-pc-windows-gnu
set -euo pipefail
cd "$(dirname "$0")"
PATH="$HOME/.local/share/ziglang-venv/bin:$PATH" cargo zigbuild --release --target x86_64-pc-windows-gnu
# Publish to dist/ (served read-only at \\dev-box\katana by share/compose.yml).
# Copy then rename, so a Windows client never sees a half-written exe.
mkdir -p dist
cp target/x86_64-pc-windows-gnu/release/katana-control.exe dist/.katana-control.exe.tmp
mv dist/.katana-control.exe.tmp dist/katana-control.exe
echo "published dist/katana-control.exe -> \\\\dev-box\\katana"
