// Overlays drawn in world space: drag-select rectangle, build placement
// preview, command-issue ping, and the minimap overlay (in screen space).

import { Container, Graphics, Sprite } from "pixi.js";
import type { AssetCache } from "../assets";
import { BUILDING_STATS, COLORS, TILE, type BuildingKind } from "../config";
import type { GameState } from "../sim/state";
import { isBuilding, isResource, isUnit } from "../sim/state";
import type { Camera } from "./camera";
import type { Input } from "../input/input";
import { textureForBuildingKind } from "./sprites";

export class WorldOverlay {
  root = new Container();
  private dragRect = new Graphics();
  private moveHint = new Graphics();
  /** Real building art: darker + semi-transparent “ghost”. */
  private buildGhost = new Sprite();
  private buildPreview = new Graphics();
  private lastGhostKind: BuildingKind | null = null;

  constructor(private readonly cache: AssetCache) {
    this.root.label = "world-overlay";
    this.buildGhost.anchor.set(0.5, 1);
    this.buildGhost.visible = false;
    this.buildGhost.alpha = 0.36;
    this.buildGhost.tint = 0x1a1a22;
    this.root.addChild(this.dragRect);
    this.root.addChild(this.moveHint);
    this.root.addChild(this.buildGhost);
    this.root.addChild(this.buildPreview);
  }

  update(input: Input, state: GameState, camera: Camera, myPlayerId: number) {
    this.dragRect.clear();
    this.moveHint.clear();
    this.buildPreview.clear();
    this.buildGhost.visible = false;

    // drag-select rectangle (drawn in screen space — root is set by main)
    if (input.state.dragStart && input.state.dragCurrent) {
      const a = camera.screenToWorld(input.state.dragStart.x, input.state.dragStart.y);
      const b = camera.screenToWorld(input.state.dragCurrent.x, input.state.dragCurrent.y);
      const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
      const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
      this.dragRect.rect(x, y, w, h).fill({ color: COLORS.parchment, alpha: 0.10 }).stroke({ width: 1, color: COLORS.parchment, alpha: 0.9 });
    }

    // Move / order preview: line from selection centroid to cursor, ring at destination
    if (!input.state.buildMode && input.state.selection.size > 0) {
      let n = 0, sx = 0, sy = 0;
      for (const id of input.state.selection) {
        const e = state.entities.get(id);
        if (isUnit(e) && e.owner === myPlayerId) {
          sx += e.pos.x; sy += e.pos.y; n++;
        }
      }
      if (n > 0) {
        const cx = sx / n, cy = sy / n;
        const dest = input.state.mouseWorld;
        this.moveHint.moveTo(cx, cy).lineTo(dest.x, dest.y).stroke({ width: 2, color: 0xf5cf5a, alpha: 0.35 });
        this.moveHint.circle(dest.x, dest.y, 12).stroke({ width: 2, color: 0xf5cf5a, alpha: 0.75 }).fill({ color: 0xf5cf5a, alpha: 0.08 });
        this.moveHint.circle(dest.x, dest.y, 4).fill({ color: 0xffffff, alpha: 0.85 });
      }
    }

    // build placement preview: building-shaped ghost + validity outline + builder lines
    if (input.state.buildMode) {
      const kind = input.state.buildMode.building as BuildingKind;
      const stats = BUILDING_STATS[kind];
      const tile = {
        x: input.state.hoverTile.x - Math.floor(stats.width / 2),
        y: input.state.hoverTile.y - Math.floor(stats.height / 2),
      };
      const valid = areaFree(state, tile.x, tile.y, stats.width, stats.height);
      const border = valid ? 0x5a9e4a : 0xcc4444;
      const px = tile.x * TILE, py = tile.y * TILE;
      const gw = stats.width * TILE, gh = stats.height * TILE;
      const cx = (tile.x + stats.width / 2) * TILE;
      const cy = (tile.y + stats.height / 2) * TILE;
      const footY = cy + (stats.height * TILE) / 2;

      if (this.lastGhostKind !== kind) {
        this.lastGhostKind = kind;
        this.buildGhost.texture = textureForBuildingKind(this.cache, kind, myPlayerId);
      }
      this.buildGhost.position.set(cx, footY);
      this.buildGhost.zIndex = cy;
      this.buildGhost.visible = true;

      this.buildPreview
        .roundRect(px + 2, py + 2, gw - 4, gh - 4, 5)
        .stroke({ width: 2, color: border, alpha: 0.75 });
      for (const id of input.state.selection) {
        const e = state.entities.get(id);
        if (isUnit(e) && e.unitKind === "pawn" && e.owner === myPlayerId) {
          this.buildPreview.moveTo(e.pos.x, e.pos.y).lineTo(cx, cy).stroke({ width: 2, color: 0xc8932b, alpha: 0.45 });
        }
      }
    } else {
      this.lastGhostKind = null;
    }
    void camera;
  }
}

function areaFree(s: GameState, tx: number, ty: number, w: number, h: number): boolean {
  for (const e of s.entities.values()) {
    if (isBuilding(e)) {
      if (tx < e.tile.x + e.width && tx + w > e.tile.x && ty < e.tile.y + e.height && ty + h > e.tile.y) return false;
    } else if (isResource(e)) {
      const rx = Math.floor(e.pos.x / TILE), ry = Math.floor(e.pos.y / TILE);
      if (rx >= tx && rx < tx + w && ry >= ty && ry < ty + h) return false;
    }
  }
  return true;
}

export class Minimap {
  root = new Container();
  private bg = new Graphics();
  private dots = new Graphics();
  private viewRect = new Graphics();
  size = { w: 220, h: 150 };

  constructor() {
    this.root.label = "minimap";
    this.root.addChild(this.bg);
    this.root.addChild(this.dots);
    this.root.addChild(this.viewRect);
  }

  update(state: GameState, camera: Camera) {
    const { w, h } = this.size;
    this.bg.clear();
    const rr = 14;
    this.bg
      .roundRect(0, 0, w, h, rr)
      .fill({ color: 0x1c1917, alpha: 0.94 })
      .stroke({ width: 3, color: 0x1a120c, alpha: 1 });
    this.bg
      .roundRect(4, 4, w - 8, h - 8, rr - 4)
      .stroke({ width: 2, color: 0xfbbf24, alpha: 0.28 });
    this.dots.clear();
    const sx = w / state.mapW;
    const sy = h / state.mapH;
    for (const e of state.entities.values()) {
      if (isUnit(e)) {
        const c = e.owner === 0 ? 0x4ade80 : 0xf87171;
        this.dots.rect(e.pos.x * sx - 1, e.pos.y * sy - 1, 2, 2).fill(c);
      } else if (isBuilding(e)) {
        const c = e.owner === 0 ? 0x4ade80 : 0xf87171;
        this.dots.rect(e.tile.x * 64 * sx, e.tile.y * 64 * sy, e.width * 64 * sx, e.height * 64 * sy).fill(c);
      } else if (isResource(e)) {
        const c = e.nodeKind === "tree" ? 0x2f6f3a : e.nodeKind === "gold" ? 0xeab308 : 0xfacc15;
        this.dots.rect(e.pos.x * sx - 1, e.pos.y * sy - 1, 2, 2).fill(c);
      }
    }
    // viewport rect
    this.viewRect.clear();
    const vx = camera.x * sx;
    const vy = camera.y * sy;
    const vw = (camera.vw / camera.zoom) * sx;
    const vh = (camera.vh / camera.zoom) * sy;
    this.viewRect
      .roundRect(vx, vy, vw, vh, 5)
      .stroke({ width: 2, color: 0xffffff, alpha: 0.92 });
  }
}
