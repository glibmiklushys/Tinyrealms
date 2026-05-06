// Camera controller. World-to-screen and screen-to-world transforms.

import { clamp } from "../sim/geom";

export class Camera {
  x = 0;          // top-left of viewport in world px
  y = 0;
  zoom = 1;
  vw = 1280;
  vh = 720;

  constructor(public worldW: number, public worldH: number) {}

  resize(w: number, h: number) { this.vw = w; this.vh = h; this.clamp(); }

  setZoom(z: number, anchorScreen?: { x: number; y: number }) {
    const newZ = clamp(z, 0.5, 2.4);
    if (anchorScreen) {
      const wx = this.x + anchorScreen.x / this.zoom;
      const wy = this.y + anchorScreen.y / this.zoom;
      this.zoom = newZ;
      this.x = wx - anchorScreen.x / this.zoom;
      this.y = wy - anchorScreen.y / this.zoom;
    } else {
      this.zoom = newZ;
    }
    this.clamp();
  }

  pan(dx: number, dy: number) { this.x += dx; this.y += dy; this.clamp(); }

  centerOn(wx: number, wy: number) {
    this.x = wx - this.vw / (2 * this.zoom);
    this.y = wy - this.vh / (2 * this.zoom);
    this.clamp();
  }

  clamp() {
    const viewW = this.vw / this.zoom;
    const viewH = this.vh / this.zoom;
    this.x = clamp(this.x, -100, this.worldW - viewW + 100);
    this.y = clamp(this.y, -100, this.worldH - viewH + 100);
  }

  screenToWorld(sx: number, sy: number) {
    return { x: this.x + sx / this.zoom, y: this.y + sy / this.zoom };
  }
  worldToScreen(wx: number, wy: number) {
    return { x: (wx - this.x) * this.zoom, y: (wy - this.y) * this.zoom };
  }
}
