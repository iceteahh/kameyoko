import type { HandFrame, PoseFrame, RawFrame, V3 } from '../types';

export interface Recording {
  version: 1;
  aspect: number;
  createdAt: string;
  frames: { t: number; raw: RawFrame }[];
}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
const pts = (ps: V3[]) => ps.map((p) => ({ x: r4(p.x), y: r4(p.y), z: r4(p.z) }));
const pose = (p: PoseFrame): PoseFrame => ({ image: pts(p.image), world: pts(p.world), vis: p.vis.map(r4) });
const hand = (h: HandFrame): HandFrame => ({ image: pts(h.image), world: pts(h.world), score: r4(h.score) });

/**
 * Records raw detector output (landmarks only, no video) so a misbehaving
 * gesture can be replayed through the same pipeline in tests.
 */
export class Recorder {
  active = false;
  private frames: Recording['frames'] = [];
  private t0 = 0;

  static readonly MAX_SECONDS = 60;

  start(now: number) {
    this.active = true;
    this.frames = [];
    this.t0 = now;
  }

  /** Returns false once the recording hit its length cap. */
  push(raw: RawFrame, now: number): boolean {
    if (!this.active) return true;
    const t = now - this.t0;
    if (t > Recorder.MAX_SECONDS) return false;
    this.frames.push({ t: r4(t), raw: { poses: raw.poses.map(pose), hands: raw.hands.map(hand) } });
    return true;
  }

  stop(aspect: number): number {
    this.active = false;
    const rec: Recording = { version: 1, aspect, createdAt: new Date().toISOString(), frames: this.frames };
    const blob = new Blob([JSON.stringify(rec)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `kameyoko-recording-${rec.createdAt.replace(/[:.]/g, '-')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    return this.frames.length;
  }
}
