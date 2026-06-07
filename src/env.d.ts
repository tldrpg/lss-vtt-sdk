// Minimal process.env declaration for bundler-replaced constants.
// Bundlers (webpack, vite, tsup) replace process.env.NODE_ENV at build time;
// this declaration satisfies the TypeScript checker without pulling in @types/node.
declare var process: { env: Record<string, string | undefined> };
