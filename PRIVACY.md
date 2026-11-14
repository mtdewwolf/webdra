# Privacy

Webdra is a static site. The application does not upload binaries, does not run a backend, and does not include analytics.

## What the app guarantees

- File bytes are parsed and disassembled in the browser, including inside a Web Worker. They are not sent with `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, or `sendBeacon`.
- There is no "open from URL" action.
- File names, hashes, and addresses are not written to the URL, `document.title`, or the history stack.
- Strings, symbols, section names, and notes are rendered as text. The UI does not assign `innerHTML`, does not auto-link URLs found in a file, and does not put file bytes into `img` or CSS `url()` values.
- Notes, renames, and bookmarks are keyed by a SHA-256 computed locally with WebCrypto. The binary itself is stored in IndexedDB only if you check **Keep a local copy**. **Session-only** mode writes nothing.
- **Delete local data** removes that IndexedDB database, `localStorage`, `sessionStorage`, and the Cache Storage entries for this origin.
- The service worker precaches only the built app shell (HTML, JS, CSS, icons, the Capstone wasm file). It ignores every other request.
- Clipboard writes happen only when you press **Copy SHA-256**. The app never reads the clipboard.
- The console is not used for file contents.
- Assets are bundled locally. There are no third-party fonts, tracking pixels, or CDN scripts.
- A strict Content-Security-Policy is shipped as a `<meta>` tag and as a real header in `_headers` (`default-src 'none'`, `script-src 'self' 'wasm-unsafe-eval'`, `connect-src 'self'`, `worker-src 'self' blob:'` with no wildcards). There is no `report-uri` or `report-to`.
- `frame-ancestors` is not valid in a meta policy, so the header policy adds `frame-ancestors 'none'` and `X-Frame-Options: DENY`. A same-origin script replaces the page if it is framed and the header was stripped.
- `<meta name="referrer" content="no-referrer">` and `X-DNS-Prefetch-Control: off` are set.

`npm run check:bundle` fails the build if `dist/` contains an unexpected external origin, an analytics SDK, a preconnect or dns-prefetch hint, or a `fetch` / XHR / WebSocket / beacon / EventSource call aimed at an external URL. React's DOM namespace constants (`http://www.w3.org/...`) are compared locally and are allowlisted. React's minified error links are rewritten so they are not URLs.

## What the host can still see

"No logs" describes the application, not the network in front of it. Whoever serves the static files can see visitor IP addresses, user agents, and request URLs for the app shell. Webdra does not send your file in those requests.

The primary host is **Cloudflare Workers static assets**:

- `observability.enabled` is false and `logpush` is false in `wrangler.jsonc`. Leave them that way.
- Do not enable Cloudflare Web Analytics. The app does not embed its beacon, and the bundle check would fail if it appeared.
- Workers Logs and Logpush must stay off. They are separate from the edge still seeing the connection.
- The deploy token needs **Workers Scripts: Edit** on the account. It does not need Workers Tail, Logpush, or Analytics permission.

GitHub Pages, if you turn on the optional manual workflow, cannot set CSP or `frame-ancestors` headers. The meta policy and frame buster still apply, and GitHub can log visitor IPs. Cloudflare Workers (or any host that honors `_headers` / the sample nginx config) can set the real headers.

## Local preferences

Font scale and the high-contrast flag are stored in `localStorage` under `webdra.font` and `webdra.contrast`. They are not derived from the file. **Delete local data** clears them. Session-only mode is remembered for the tab in `sessionStorage`.
