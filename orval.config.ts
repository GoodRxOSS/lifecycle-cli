import * as dotenv from 'dotenv';
import { defineConfig } from 'orval';

dotenv.config({ quiet: true });

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? process.env.LIFECYCLE_API_URL;

if (!apiUrl) {
  throw new Error('NEXT_PUBLIC_API_URL or LIFECYCLE_API_URL is required to generate API types');
}

export default defineConfig({
  client: {
    input: {
      target: `${apiUrl.replace(/\/$/, '')}/api/docs`,
      unsafeDisableValidation: true,
    },
    output: {
      // Orval 8 requires a target; only the schemas are kept, so the client is written to a cache dir.
      target: './node_modules/.cache/orval/client.ts',
      schemas: './src/lib/generated',
    },
  },
});
