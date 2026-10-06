// Downloads the pose + hand landmarker models into public/models for offline use.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dest = join(root, 'public/models');
const BASE = 'https://storage.googleapis.com/mediapipe-models';
const MODELS = {
  'pose_landmarker_lite.task': `${BASE}/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task`,
  'pose_landmarker_full.task': `${BASE}/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task`,
  'hand_landmarker.task': `${BASE}/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task`,
};

mkdirSync(dest, { recursive: true });
for (const [name, url] of Object.entries(MODELS)) {
  process.stdout.write(`downloading ${name} ... `);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(join(dest, name), buf);
  console.log(`${(buf.length / 1e6).toFixed(1)} MB`);
}
