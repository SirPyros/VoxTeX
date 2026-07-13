// Copies speech-rule-engine's mathmaps (locale JSON) into public/ so SRE can
// fetch them locally at runtime — no CDN, everything stays client-side.
import { cpSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

let src = null;
let dir = here;
for (let i = 0; i < 8; i++) {
  const candidate = join(dir, 'node_modules', 'speech-rule-engine', 'lib', 'mathmaps');
  if (existsSync(candidate)) {
    src = candidate;
    break;
  }
  const parent = dirname(dir);
  if (parent === dir) break;
  dir = parent;
}

if (!src) {
  console.warn('[copy-sre] speech-rule-engine mathmaps not found (not installed yet?) — math read-back will use the built-in fallback voice.');
  process.exit(0);
}

const dest = resolve(here, '..', 'public', 'sre', 'mathmaps');
cpSync(src, dest, { recursive: true });
console.log(`[copy-sre] copied mathmaps -> ${dest}`);
