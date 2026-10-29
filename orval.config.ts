import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as dotenv from 'dotenv';
import { defineConfig } from 'orval';

dotenv.config({ quiet: true });

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? process.env.LIFECYCLE_API_URL;

if (!apiUrl) {
  throw new Error('NEXT_PUBLIC_API_URL or LIFECYCLE_API_URL is required to generate API types');
}

export default defineConfig({
  client: {
    input: `${apiUrl.replace(/\/$/, '')}/api/docs`,
    output: {
      // Orval 8 requires a target; the generated client is discarded.
      target: join(tmpdir(), 'orval-lifecycle', 'client.ts'),
      schemas: './src/lib/generated',
    },
  },
});
