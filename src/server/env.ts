import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Loads environment variables for backend / worker processes.
 * Explicitly configures dotenv to search the parent directory (../.env)
 * so deploy/current/ locates deploy/.env cleanly.
 */
export function initServerEnv(): void {
  // 1. Explicitly configured path per specification: path.resolve(__dirname, '../.env')
  dotenv.config({ path: path.resolve(__dirname, '../.env') });

  // 2. Parent of current working directory: deploy/.env when running from deploy/current
  const cwdParentEnv = path.resolve(process.cwd(), '../.env');
  if (fs.existsSync(cwdParentEnv)) {
    dotenv.config({ path: cwdParentEnv });
  }

  // 3. Repository root parent when running directly from src/server
  const repoParentEnv = path.resolve(__dirname, '../../.env');
  if (fs.existsSync(repoParentEnv)) {
    dotenv.config({ path: repoParentEnv });
  }

  // 4. Local current directory .env
  const cwdEnv = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(cwdEnv)) {
    dotenv.config({ path: cwdEnv });
  }
}

// Automatically initialize on import
initServerEnv();
