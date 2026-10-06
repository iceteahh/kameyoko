import { CONFIG } from '../config';
import type { PlayerCtx } from '../game/game';
import type { Layout } from '../layout';
import { HAND_CONNECTIONS, POSE_CONNECTIONS } from '../tracking/landmarks';
import type { Tracker } from '../tracking/tracker';

/** 2D debug overlay: skeletons, hands and live pose scores. */
export class Overlay {
  private ctx: CanvasRenderingContext2D;
  /** 0 = off, 1 = skeleton, 2 = skeleton + live pose scores. */
  mode: 0 | 1 | 2 = 1;

  cycle() {
    this.mode = ((this.mode + 1) % 3) as 0 | 1 | 2;
    return this.mode;
  }

  constructor(private canvas: HTMLCanvasElement, private layout: Layout) {
    this.ctx = canvas.getContext('2d')!;
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = this.layout.width * dpr;
    this.canvas.height = this.layout.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  draw(tracker: Tracker, players: [PlayerCtx, PlayerCtx]) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.layout.width, this.layout.height);
    if (this.mode === 0) return;
    tracker.slots.forEach((slot, i) => {
      const frame = slot.frame;
      if (!slot.present || !frame) return;
      const css = CONFIG.colors.players[i].css;
      const pts = frame.pose.image.map((p) => this.layout.toScreen(p));
      ctx.lineWidth = 3;
      ctx.strokeStyle = css;
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      for (const [a, b] of POSE_CONNECTIONS) {
        if (frame.pose.vis[a] < 0.3 || frame.pose.vis[b] < 0.3) continue;
        ctx.moveTo(pts[a].x, pts[a].y);
        ctx.lineTo(pts[b].x, pts[b].y);
      }
      ctx.stroke();
      ctx.fillStyle = '#fff';
      pts.forEach((p, k) => {
        if (k < 11 && k !== 0) return;
        if (frame.pose.vis[k] < 0.3) return;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.lineWidth = 1.5;
      for (const hand of frame.hands) {
        const hp = hand.image.map((p) => this.layout.toScreen(p));
        ctx.beginPath();
        for (const [a, b] of HAND_CONNECTIONS) {
          ctx.moveTo(hp[a].x, hp[a].y);
          ctx.lineTo(hp[b].x, hp[b].y);
        }
        ctx.stroke();
      }
      const a = players[i].analysis;
      if (a && this.mode === 2) {
        const feet = this.layout.toScreen({ x: (a.box.x0 + a.box.x1) / 2, y: a.box.y1 });
        ctx.globalAlpha = 0.85;
        ctx.font = '600 12px ui-monospace, Menlo, monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = css;
        const fmt = (v: number | null) => (v === null ? '–' : v.toFixed(2));
        const y = Math.min(feet.y + 22, this.layout.height - 76);
        const c = players[i].ctrl;
        ctx.fillText(`charge ${fmt(a.chargePose)}  fire ${fmt(a.firePose)}  power ${fmt(a.powerUpPose)}  stance ${fmt(a.stance)}  palms ${fmt(a.palms)}`, feet.x, y);
        ctx.fillText(
          `ext ${fmt(a.extension)}  together ${fmt(a.fireTogether)}  height ${fmt(a.fireHeight)}  moved ${fmt(c.moved)}  release ${fmt(c.release)}`,
          feet.x,
          y + 16,
        );
      }
      ctx.globalAlpha = 1;
    });
  }
}
