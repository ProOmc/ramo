import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Vite builds the React renderer; esbuild keeps the kernel bundles.
 * The `.js`→`.ts` fallback mirrors `tools/build.mjs` (NodeNext imports
 * of .ts files by their JS specifier), so React code can import
 * `../renderer/memory-surface.js` exactly like the esbuild path does.
 */
function nodeNextTsResolver(): Plugin {
  return {
    name: 'ramo-nodenext-ts-resolver',
    enforce: 'pre',
    resolveId(id, importer) {
      if (!id.endsWith('.js')) return null;
      const candidate = id.slice(0, -3) + '.ts';
      const base = importer ? resolve(resolve(importer, '..'), candidate) : resolve(candidate);
      // Fast path for repo-relative specifiers handled by vite itself.
      if (!existsSync(resolve(candidate)) && !existsSync(base) && !existsSync(base + 'x')) {
        const asTsx = id.slice(0, -3) + '.tsx';
        const baseTsx = resolve(resolve(importer || '.', '..'), asTsx);
        if (existsSync(baseTsx)) return baseTsx;
        if (existsSync(asTsx)) return asTsx;
        return null;
      }
      return existsSync(base) ? base : existsSync(candidate) ? candidate : existsSync(base + 'x') ? base + 'x' : null;
    },
  };
}

export default defineConfig({
  plugins: [nodeNextTsResolver(), react()],
  define: {
    // The pre-bundled React CJS checks this at module-init time.
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    // Kernel bundles occupy `app/` alongside this output; never wipe it.
    emptyOutDir: false,
    outDir: 'app',
    sourcemap: false,
    minify: false,
    target: 'es2022',
    lib: {
      entry: resolve(__dirname, 'src/ui/app.tsx'),
      formats: ['iife'],
      fileName: () => 'renderer.js',
      name: 'RamoUI',
    },
    rollupOptions: {
      output: {
        assetFileNames: 'ui.css',
        extend: true,
      },
    },
  },
});
