import type { V2 } from './types';

/** Maps normalized video coordinates to screen pixels using "cover" fitting. */
export class Layout {
  width = 1;
  height = 1;
  videoW = 1280;
  videoH = 720;
  scale = 1;
  offX = 0;
  offY = 0;

  update(width: number, height: number, videoW = this.videoW, videoH = this.videoH) {
    this.width = width;
    this.height = height;
    this.videoW = videoW || 1280;
    this.videoH = videoH || 720;
    this.scale = Math.max(width / this.videoW, height / this.videoH);
    this.offX = (width - this.videoW * this.scale) / 2;
    this.offY = (height - this.videoH * this.scale) / 2;
  }

  get aspect() {
    return this.videoW / this.videoH;
  }

  toScreen(p: V2): V2 {
    return {
      x: this.offX + p.x * this.videoW * this.scale,
      y: this.offY + p.y * this.videoH * this.scale,
    };
  }

  /** Normalized height units -> pixels. */
  lengthToScreen(l: number) {
    return l * this.videoH * this.scale;
  }

  /**
   * Coefficients (ax, bx, ay, by) so the composite shader can sample the
   * mirrored video: videoUV = (bx - uv.x * ax, by + uv.y * ay).
   */
  videoUvMap(): [number, number, number, number] {
    const vw = this.videoW * this.scale;
    const vh = this.videoH * this.scale;
    return [this.width / vw, 1 + this.offX / vw, this.height / vh, 1 - (this.height - this.offY) / vh];
  }
}
