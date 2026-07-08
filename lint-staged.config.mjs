// Mirrors lifecycle-ui: on any staged source file, run the full validate
// (format:write + lint + typecheck). The function form runs it once, not per file.
export default {
  '*.{ts,js,mjs,cjs,json,md}': () => ['pnpm validate'],
};
