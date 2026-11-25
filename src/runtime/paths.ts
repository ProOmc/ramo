/**
 * Where the runtime lives on disk.
 *
 * The worker, the search binaries and the terminal helper are installed next to
 * each other. The root is passed in rather than derived from `import.meta`, so
 * the runtime can be exercised from a test or a development checkout without
 * bundling.
 */

/** The directory that holds the runtime: `node/`, `node_modules/` and the worker. */
let currentRoot = process.cwd();

/** Point the runtime at its installation directory. */
export function setRuntimeRoot(directory: string): void {
	currentRoot = directory;
}

/** The directory that holds the runtime. */
export function runtimeRoot(): string {
	return currentRoot;
}

/**
 * The directory that holds the bundled executables.
 *
 * `fd` and `rg` ship with Ramo in `node/`; nothing is downloaded at runtime.
 */
export function binariesDirectory(): string {
	return `${currentRoot}/node`;
}
