import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

// Ship the third-party licenses (three.js, MediaPipe) with every build; Apache-2.0 requires it.
const thirdPartyNotices: Plugin = {
  name: 'third-party-notices',
  generateBundle() {
    this.emitFile({
      type: 'asset',
      fileName: 'THIRD_PARTY_NOTICES.txt',
      source: readFileSync(new URL('./THIRD_PARTY_NOTICES.txt', import.meta.url), 'utf8'),
    });
  },
};

export default defineConfig({
  plugins: [thirdPartyNotices],
  server: { port: 5173, open: true },
  // three.js + MediaPipe are large by nature.
  build: { chunkSizeWarningLimit: 1500 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
} as never);
