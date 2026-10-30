import esbuild from 'esbuild';
import fs from 'fs';

const entryPoints = [
  'server/api/admin/login.ts',
  'server/api/admin/session.ts',
  'server/api/admin/logout.ts',
  'server/api/admin/releases.ts',
  'server/api/admin/releases/[id].ts',
  'server/api/admin/licenses.ts',
  'server/api/admin/licenses/[id].ts',
  'server/api/admin/upload.ts',
  'server/api/admin/publish.ts',
  'server/api/admin/notify.ts',
  'server/api/releases/latest.ts',
  'server/api/releases/manifest.ts',
  'server/api/releases/download.ts',
  'server/api/devices/register.ts',
];

async function build() {
  console.log('Building serverless API functions with esbuild...');

  // Ensure output directories exist in api/
  fs.mkdirSync('api/admin/releases', { recursive: true });
  fs.mkdirSync('api/admin/licenses', { recursive: true });
  fs.mkdirSync('api/releases', { recursive: true });
  fs.mkdirSync('api/devices', { recursive: true });

  await esbuild.build({
    entryPoints,
    outbase: 'server/api',
    outdir: 'api',
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'esm',
    banner: {
      js: "import { createRequire as __bundleCreateRequire } from 'node:module'; const require = __bundleCreateRequire(import.meta.url);",
    },
    sourcemap: false,
    minify: false,
    logLevel: 'info',
  });

  console.log('API functions successfully bundled into api/');
}

build().catch((err) => {
  console.error('API build failed:', err);
  process.exit(1);
});
