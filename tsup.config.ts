import { defineConfig } from 'tsup';

/**
 * tsup — hyper-fast esbuild-based bundler for production artifacts.
 *
 * - `treeshake` eliminates dead code paths, reducing final bundle size.
 * - `minify` compresses identifiers and whitespace for deployment.
 * - `clean` purges stale build artifacts before each build.
 * - `sourcemap` is enabled so production error stacks map back to TS source.
 * - External packages (node_modules) are NOT bundled — they're resolved at
 *   runtime via `node_modules`, keeping the bundle lean and npm-auditable.
 */
export default defineConfig({
	entry: ['src/server.ts'],
	outDir: 'dist',
	format: ['cjs'],
	target: 'node20',
	clean: true,
	minify: true,
	treeshake: true,
	sourcemap: true,
	splitting: false,
	dts: false,
	noExternal: [],
});
