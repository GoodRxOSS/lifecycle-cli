import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'src/lib/generated/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Node CLI: declare Node globals (URL, process, etc.) for all files.
  { languageOptions: { globals: { ...globals.node } } },
  // eslint-config-prettier goes last: turns off any stylistic rules that would
  // fight Prettier. Prettier owns formatting; ESLint owns correctness.
  prettier,
);
