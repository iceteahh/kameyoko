import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { replay } from './replay';

// Drop recordings (press K in the app) into tests/fixtures/ to replay them here.
// Name them *.charge-only.json when the beam must NOT fire, *.fire.json when it must.
const dir = fileURLToPath(new URL('./fixtures', import.meta.url));
const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')) : [];

describe.skipIf(files.length === 0)('recorded sessions', () => {
  for (const file of files) {
    it(file, () => {
      const events = replay(join(dir, file));
      console.table(events);
      const fired = events.some((e) => e.event === 'fire');
      if (file.includes('charge-only')) expect(fired).toBe(false);
      if (file.includes('.fire.')) expect(fired).toBe(true);
    });
  }
});
