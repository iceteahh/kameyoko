import { readFileSync } from 'node:fs';
import type { Recording } from '../src/debug/recorder';
import { analyzePose } from '../src/gesture/analyze';
import { GestureController, type GestureEvent } from '../src/gesture/controller';
import { Tracker } from '../src/tracking/tracker';

export interface ReplayEvent {
  t: number;
  player: 0 | 1;
  event: GestureEvent['type'];
  charge: number;
  chargePose: number;
  release: number;
  moved: number;
}

/** Runs a recorded session through tracker → analysis → gesture controller at 60 fps. */
export function replay(path: string): ReplayEvent[] {
  const rec = JSON.parse(readFileSync(path, 'utf8')) as Recording;
  const tracker = new Tracker();
  const ctrls = [new GestureController(), new GestureController()];
  const out: ReplayEvent[] = [];
  let f = 0;
  const end = rec.frames.at(-1)?.t ?? 0;
  for (let t = 0; t <= end; t += 1 / 60) {
    while (f < rec.frames.length && rec.frames[f].t <= t) tracker.update(rec.frames[f++].raw, t, rec.aspect);
    tracker.tick(t);
    tracker.slots.forEach((slot, i) => {
      const a = slot.present && slot.frame ? analyzePose(slot.frame, rec.aspect) : null;
      for (const e of ctrls[i].update(1 / 60, a)) {
        if (e.type === 'callout') continue;
        out.push({
          t: Math.round(t * 100) / 100,
          player: i as 0 | 1,
          event: e.type,
          charge: Math.round(ctrls[i].charge * 100) / 100,
          chargePose: Math.round((a?.chargePose ?? 0) * 100) / 100,
          release: Math.round(ctrls[i].release * 100) / 100,
          moved: Math.round(ctrls[i].moved * 100) / 100,
        });
      }
    });
  }
  return out;
}
