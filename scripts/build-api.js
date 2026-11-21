import esbuild from 'esbuild';
import fs from 'fs';

const wrappers = [
  {
    outPath: 'api/admin/auth.js',
    importPath: '../../server/compiledApiHandler.js',
    routeLabel: '/api/admin/auth',
    disableBodyParser: false,
  },
  {
    outPath: 'api/admin/releases.js',
    importPath: '../../server/compiledApiHandler.js',
    routeLabel: '/api/admin/releases',
    disableBodyParser: false,
  },
  {
    outPath: 'api/admin/licenses.js',
    importPath: '../../server/compiledApiHandler.js',
    routeLabel: '/api/admin/licenses',
    disableBodyParser: false,
  },
  {
    outPath: 'api/admin/upload.js',
    importPath: '../../server/compiledApiHandler.js',
    routeLabel: '/api/admin/upload',
    disableBodyParser: true,
  },
  {
    outPath: 'api/admin/notify.js',
    importPath: '../../server/compiledApiHandler.js',
    routeLabel: '/api/admin/notify',
    disableBodyParser: false,
  },
  {
    outPath: 'api/releases.js',
    importPath: '../server/compiledApiHandler.js',
    routeLabel: '/api/releases',
    disableBodyParser: false,
  },
  {
    outPath: 'api/devices/register.js',
    importPath: '../../server/compiledApiHandler.js',
    routeLabel: '/api/devices/register',
    disableBodyParser: false,
  },
  {
    outPath: 'api/auth.js',
    importPath: '../server/compiledApiHandler.js',
    routeLabel: '/api/auth',
    disableBodyParser: false,
  },
];

function createWrapperCode({ importPath, routeLabel, disableBodyParser }) {
  const configExport = disableBodyParser
    ? `\nexport const config = {\n  api: {\n    bodyParser: false,\n  },\n};\n`
    : '';

  return `import { handleApiRequest } from '${importPath}';
${configExport}
export default async function handler(req, res) {
  try {
    const handled = await handleApiRequest(req, res);
    if (!handled && !(res.writableEnded || res.headersSent)) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ success: false, error: 'Endpoint not found' }));
    }
  } catch (err) {
    console.error('Unhandled error in ${routeLabel}:', err);
    if (!(res.writableEnded || res.headersSent)) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(
        JSON.stringify({
          success: false,
          error: err instanceof Error ? err.message : 'Internal Server Error',
        })
      );
    }
  }
}
`;
}

async function build() {
  console.log(`Building serverless API dispatcher and ${wrappers.length} route wrappers...`);

  // 1. Compile local TypeScript server code into a single clean ESM module
  //    while keeping node_modules (firebase, @grpc/grpc-js, etc.) external.
  await esbuild.build({
    entryPoints: ['server/apiHandler.ts'],
    outfile: 'server/compiledApiHandler.js',
    bundle: true,
    packages: 'external',
    platform: 'node',
    target: 'node20',
    format: 'esm',
    sourcemap: false,
    logLevel: 'info',
  });

  // 2. Ensure API directories exist without deleting tracked serverless entrypoints (8 functions <= 12 limit)
  fs.mkdirSync('api/admin', { recursive: true });
  fs.mkdirSync('api/devices', { recursive: true });

  // 3. Ensure all lightweight serverless function entry wrappers exist and stay up to date
  for (const wrapper of wrappers) {
    const expectedCode = createWrapperCode(wrapper);
    const existingCode = fs.existsSync(wrapper.outPath)
      ? fs.readFileSync(wrapper.outPath, 'utf-8')
      : null;
    if (existingCode !== expectedCode) {
      fs.writeFileSync(wrapper.outPath, expectedCode, 'utf-8');
    }
  }

  console.log(`Successfully built server/compiledApiHandler.js and verified ${wrappers.length} API functions in api/.`);
}

build().catch((err) => {
  console.error('API build failed:', err);
  process.exit(1);
});
