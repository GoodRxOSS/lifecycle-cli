import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  target: 'node20',
  clean: true,
  banner: {
    // shebang + createRequire shim so bundled CJS deps can require() node builtins from ESM
    js: "#!/usr/bin/env node\nimport { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);",
  },
  // bundle everything so `pnpm link --global` works without hoisted deps
  noExternal: [/.*/],
});
