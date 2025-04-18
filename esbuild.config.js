import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: 'dist/index.mjs',
  banner: {
    js: `
      // Polyfill for dynamic require
      import { createRequire } from 'module';
      import { fileURLToPath } from 'url';
      import { dirname } from 'path';
      
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      const require = createRequire(import.meta.url);
    `,
  },
  loader: {
    '.ts': 'ts',
  },
  mainFields: ['module', 'main'],
  resolveExtensions: ['.ts', '.js', '.mjs', '.json'],
});

console.log('Build completed successfully!'); 