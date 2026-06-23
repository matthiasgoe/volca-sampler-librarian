# Volca Sampler Librarian

A simplified, librarian-style interface for loading samples onto the
**volca sample v1**. It lets you import a batch of samples, keep them in a persistent
library, play them, drag each onto one of the slots, and transfer your
selection to the device in one pass.

This is a fork of [**Volca Sampler**](https://github.com/benwiley4000/volca-sampler),
an app created by [Ben Wiley](https://benwiley.org/). All of the actually hard parts 
like Syro encoding, audio handling, and device transfer are his work; this fork
only adds a different front-end on top. I made this mostly for myself. 

> “volca sample” is a trademark of KORG Inc., who is not affiliated with this app.

## What this fork does

- **Import many files at once** instead of one at a time.
- **0–99 slot grid** with drag-and-drop assignment; a sample stays in the
  library and can be placed in more than one slot.
- **Batch transfer** of all or a selected subset of slots.
- A library UI 
- An optional **Electron wrapper** and a one-command build script to produce a
  standalone macOS app (`build-mac-app.sh`).

## Run it in a browser (development)

This project compiles a small WebAssembly module (the Korg Syro encoder) with
[Emscripten](https://emscripten.org/), so you need `emcc` available the first
time you build.

```bash
# 1. install Emscripten (just once) — see https://emscripten.org/docs/getting_started/downloads.html
#    e.g. via emsdk:
#    git clone https://github.com/emscripten-core/emsdk.git
#    cd emsdk && ./emsdk install latest && ./emsdk activate latest && source ./emsdk_env.sh && cd ..

# 2. build the audio engine + factory data
./build-bindings.sh
node ./build-factory-samples-index   # optional; safe to skip if it errors

# 3. install dependencies and start the dev server
npm install
npm start
```

Then open the address printed in the terminal (served over `http://`, which is
required for the audio engine to work).

To produce a static build instead, run `npm run build:normal` and serve the
`build/` folder over HTTP.

## Build a standalone mac app

```bash
chmod +x build-mac-app.sh
./build-mac-app.sh
```

This installs Emscripten locally if needed, compiles everything, and packages a
`.app`/`.dmg` into `dist/`. The build is unsigned, so the first launch needs a
right-click → Open.

## Credits & license

Original app: **[Volca Sampler](https://github.com/benwiley4000/volca-sampler)**
by [Ben Wiley](https://benwiley.org/). This fork inherits the original project's
license (see `LICENSE`); please keep the original author's name and license
intact.
