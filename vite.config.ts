import { copyFileSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { metaCsp } from './privacy/csp.mjs';
import { renderServiceWorker } from './src/privacy/serviceWorkerSource.ts';

const base = process.env.GITHUB_PAGES ? '/webdra/' : '/';

export default defineConfig({
  base,
  plugins: [react(), capstoneBrowser(), devCsp(), copyCapstoneWasm(), stripInertUrls(), emitServiceWorker()],
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 4000,
  },
  worker: {
    format: 'es',
    plugins: () => [capstoneBrowser()],
    rollupOptions: {
      output: {
        codeSplitting: false,
      },
    },
  },
});

function capstoneBrowser(): Plugin {
  return {
    name: 'capstone-browser',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes(`${path.sep}capstone.js`) && !id.endsWith('capstone.js')) return null;
      return code
        .replaceAll('require("node:fs")', 'null')
        .replaceAll("require('node:fs')", 'null')
        .replace(
          'var ENVIRONMENT_IS_NODE=globalThis.process?.versions?.node&&globalThis.process?.type!="renderer";',
          'var ENVIRONMENT_IS_NODE=false;',
        )
        .replace('var out=console.log.bind(console);var err=console.error.bind(console);', 'var out=function(){};var err=function(){};');
    },
  };
}

function devCsp(): Plugin {
  return {
    name: 'dev-csp',
    apply: 'serve',
    transformIndexHtml(html) {
      return html.replace(
        /(<meta http-equiv="Content-Security-Policy" content=")[^"]*(")/,
        "$1default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:; connect-src 'self' ws: wss:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; worker-src 'self' blob:; manifest-src 'self'$2",
      );
    },
  };
}

function copyCapstoneWasm(): Plugin {
  const copy = () => {
    mkdirSync('public', { recursive: true });
    copyFileSync('node_modules/@alexaltea/capstone-js/dist/capstone.wasm', 'public/capstone.wasm');
  };
  return {
    name: 'copy-capstone-wasm',
    buildStart: copy,
    configureServer: copy,
  };
}

function stripInertUrls(): Plugin {
  return {
    name: 'strip-inert-urls',
    apply: 'build',
    generateBundle(_options, bundle) {
      for (const item of Object.values(bundle)) {
        if (item.type === 'chunk') item.code = item.code.replaceAll('https://react.dev/errors/', 'react-error:');
      }
    },
  };
}

function emitServiceWorker(): Plugin {
  return {
    name: 'emit-service-worker',
    apply: 'build',
    closeBundle() {
      const dist = path.resolve('dist');
      const html = readFileSync(path.join(dist, 'index.html'), 'utf8');
      if (!html.includes(metaCsp)) throw new Error('Built index.html is missing the strict Content-Security-Policy');
      const files = walk(dist).filter((file) => !file.endsWith(`${path.sep}sw.js`) && !file.endsWith(`${path.sep}_headers`));
      const assets = files.map((file) => `${base}${path.relative(dist, file).split(path.sep).join('/')}`);
      const root = base.endsWith('/') ? base : `${base}/`;
      if (!assets.includes(root)) assets.push(root);
      writeFileSync(path.join(dist, 'sw.js'), renderServiceWorker(assets));
    },
  };
}

function walk(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) found.push(...walk(full));
    else found.push(full);
  }
  return found;
}
