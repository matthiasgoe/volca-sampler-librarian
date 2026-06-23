#!/usr/bin/env bash
#
# Builds the Volca Sampler Mac app (.app + .dmg) from scratch.
# Run this ON A MAC, from inside the volca-sampler/ directory:
#
#     chmod +x build-mac-app.sh
#     ./build-mac-app.sh
#
# When it finishes, your app is in the dist/ folder.
#
set -euo pipefail

cd "$(dirname "$0")"
ROOT="$(pwd)"

echo "==> Volca Sampler — Mac app build"

# --- 1. Make sure the Korg Syro C sources are present -----------------------
# (these live in a git submodule; if you got this as a plain zip they may be
#  missing, so we fetch them either way)
if [ ! -f "syro/volcasample/syro/korg_syro_volcasample.c" ]; then
  echo "==> Fetching Korg Syro sources..."
  if [ -d ".git" ]; then
    git submodule update --init --recursive
  else
    rm -rf syro/volcasample
    git clone --branch fix-comp https://github.com/benwiley4000/volcasample syro/volcasample
  fi
fi

# --- 2. Make sure Emscripten (emcc) is available ----------------------------
if ! command -v emcc >/dev/null 2>&1; then
  echo "==> Emscripten not found — installing a local copy via emsdk..."
  if [ ! -d "$ROOT/emsdk" ]; then
    git clone https://github.com/emscripten-core/emsdk.git "$ROOT/emsdk"
  fi
  "$ROOT/emsdk/emsdk" install latest
  "$ROOT/emsdk/emsdk" activate latest
  # shellcheck disable=SC1091
  source "$ROOT/emsdk/emsdk_env.sh"
fi
echo "==> Using emcc: $(command -v emcc)"

# --- 3. Install node dependencies -------------------------------------------
# (must happen before the factory-samples step, which needs these packages)
echo "==> Installing npm dependencies (this can take a few minutes)..."
npm install

# --- 4. Build the WASM bindings + factory sample index ----------------------
echo "==> Building Syro WASM bindings..."
chmod +x build-bindings.sh
./build-bindings.sh

echo "==> Building factory samples index..."
node ./build-factory-samples-index

# --- 5. Build the web app ---------------------------------------------------
echo "==> Building the web app..."
npm run build:normal

# --- 6. Package the Mac app -------------------------------------------------
echo "==> Packaging the Mac app with electron-builder..."
npx electron-builder --mac

echo ""
echo "==> Done. Your app is in:  $ROOT/dist"
echo "    - Volca Sampler-*.dmg     (double-click to install)"
echo "    - mac/Volca Sampler.app   (drag to /Applications)"
echo ""
echo "Note: this build is unsigned. The first time you open it, macOS may say"
echo "it can't verify the developer. Right-click the app → Open → Open, or run:"
echo "    xattr -dr com.apple.quarantine \"/Applications/Volca Sampler.app\""
