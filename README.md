# Webdra

Webdra is a private, browser-local binary inspector in the spirit of Ghidra's listing: open an ELF, PE/COFF, or Mach-O file, read its headers, and follow disassembly, strings, cross-references, and a control-flow graph. Nothing you open is uploaded.

Decompilation is not in v1. The screen is a multi-pane dark workspace. Renames and comments stay in this browser unless you export a project JSON file.

## Privacy

The short version: the site is static, analysis runs in a Web Worker, and the bundle check is a heuristic backed by an end-to-end test that only allows requests for files in the build. Read [PRIVACY.md](PRIVACY.md) for the guarantees, the host IP limit, and why a shared `github.io` origin is a poor place for sensitive files. Prefer the Workers host or a custom domain.

A line in the UI says the same thing: data stays on this device.

## Usage

1. Open a file with **Open** or drop it on the window. Files larger than 50 MB are refused.
2. The worker parses headers, scans strings, and disassembles the entry point. Other functions disassemble when you select them.
3. The function list, hex view, strings, graph, and cross-references follow the current address.
4. `G` goes to an address, `N` renames, `;` comments, `X` shows xrefs, `B` bookmarks, `Ctrl+K` opens the command palette, and Alt+Left / Alt+Right walk history.
5. **Session-only** keeps notes in memory. Otherwise the file's SHA-256 is stored in IndexedDB with your notes, even when the binary itself is not. **Keep a local copy** is off unless you opt in. Anyone using this browser profile can see those hashes.
6. **Export notes** / **Import notes** round-trip a project JSON file that contains the hash, renames, comments, and bookmarks, not the binary. Import only applies when that file is open and the hash matches.
7. **Delete local data** removes Webdra's database, `webdra.` preferences, `webdra-shell-*` caches, and this app's service worker. If another tab still holds the database, it asks you to close that tab and does not claim success.

Architectures in v1: x86, x86-64, and ARM64 (ARM 32-bit is parsed; Thumb is used when a symbol address is odd). Fat Mach-O files get a slice picker. If a header is truncated but the magic matches, **Parse anyway** keeps the fields that could be read.

## Local development

```bash
npm install
npm run fixtures   # optional; rebuilds tests/fixtures with gcc and clang
npm test
npm run build
npm run check:bundle
npm run test:e2e
npm run dev
```

`npm run dev` relaxes the Content-Security-Policy so Vite's module scripts and hot reload can run. The production build keeps the strict policy. Dev does not register the service worker.

## Deploy

The primary target is Cloudflare Workers static assets (`wrangler.jsonc`):

- `name` is `webdra`
- `assets.directory` is `./dist`
- there is no Worker script
- `observability.enabled` and `logpush` are false
- `workers_dev` is true

GitHub Actions workflow **Deploy** runs on push to `Master` and on `workflow_dispatch`. It runs the unit tests, production build, bundle check, and Playwright test before `cloudflare/wrangler-action`. Deploy runs only when `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are set. Otherwise it prints a notice and succeeds without deploying. The token needs **Workers Scripts: Edit**. Do not grant Tail, Logpush, or Analytics, and do not enable Cloudflare Web Analytics.

`public/_headers` is copied into the build and becomes the real response headers, including `frame-ancestors 'none'`. The meta policy stays as a second layer. See [PRIVACY.md](PRIVACY.md).

**GitHub Pages (optional)** is a `workflow_dispatch` workflow only. It runs the same tests against a `/webdra/` build before uploading. It is not the default host: Pages cannot set CSP headers, and `mtdewwolf.github.io` is one origin shared by every Pages site on the account, so those sites can read Webdra's IndexedDB. Prefer Workers or a custom domain.

`deploy/nginx.conf` is a sample for any other static server.

## Tests

Unit tests (Vitest) parse the committed fixtures and disassemble `main` or the entry point for ELF64 x86-64 (gcc), ELF64 ARM64 (clang), ELF32 x86, PE32+ x86-64, and a fat Mach-O (clang). A crafted symbol name `<img src=x onerror=...>` is parsed and rendered as text. Playwright serves the built site with `public/_headers` applied, analyzes the ELF fixture, checks the CSP response header, and fails if any request is not one of the built files.

Fixtures are produced by `scripts/build-fixtures.mjs` and checked in so CI does not need a cross compiler. Regenerate them with gcc and clang.

## Layout

The UI talks to an intermediate representation (`InstructionIR`, `FunctionIR`, `ImageView`) rather than to Capstone types. `src/decompiler/stub.ts` is the empty plug-in a decompiler would implement.

## Roadmap for v2: Ghidra's decompiler on WebAssembly

v2 should compile Ghidra's C++ decompiler (`Ghidra/Features/Decompiler`) with Emscripten and return C-like text for the selected `FunctionIR`.

1. Pin a Ghidra release (Apache-2.0) and keep its `LICENSE` and `NOTICE` next to the wasm artifact.
2. Build the decompiler library with `emcc`, not the Swing UI. Start from the `decompile` library and the SLEIGH `.slaspec` / `.cspec` files for x86, x86-64, and AArch64.
3. Replace filesystem reads with an embedded spec bundle and a callback that serves bytes through `ImageView.read`. No network.
4. Expose one function: given architecture, entry address, and a memory callback, return the decompiled string. Implement the `Decompiler` interface and show it in a pane next to the listing.
5. Feed it the same function boundaries and names Webdra already recovers, then iterate on calling convention and type recovery. Indirect calls and exception handlers will be the rough edges.
6. Keep the wasm same-origin, add it to the service-worker asset list, and extend `check:bundle` so the new chunk cannot grow a CDN URL. Expect a large download; lazy-load it when the user opens the decompiler pane.

Out of scope even then: shipping Ghidra's Java UI, or uploading binaries to a server to decompile them.

## Known limitations

- Flow recovery uses Capstone's mnemonic and operand text. Indirect calls and jumps are not resolved. Data references are RIP-relative x86-64 operands plus a scan for absolute string addresses.
- The Itanium and MSVC demanglers cover common symbols, not the full languages.
- Mach-O export tries and undefined symbols are read; full dyld bind opcodes are not emulated. DWARF and PDB are not loaded.
- Addresses above `2^53` are rejected. Thumb is only selected from an odd ARM symbol address.
- The control-flow layout is a simple column layout with zoom and pan, not a full edge router.
- String filters are regular expressions capped at 200 characters. A pathological pattern can stall the tab; it still cannot leave the machine.
- The optional IndexedDB copy of a binary can fail when the browser quota is smaller than the file.
- React's production bundle contains W3C namespace strings used for DOM checks. They are allowlisted by the privacy check and are not requested.

## License

Apache-2.0. See [LICENSE](LICENSE), [NOTICE](NOTICE), and [THIRD_PARTY_LICENSES](THIRD_PARTY_LICENSES.md).
