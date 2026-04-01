import { config } from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve monorepo root `.env` from this file (not cwd — pnpm/turbo cwd can vary).
const envPath = join(dirname(fileURLToPath(import.meta.url)), '../../../.env');
config({ path: envPath });
