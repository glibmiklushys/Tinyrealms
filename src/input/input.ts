// Input controller: keyboard for camera + hotkeys, mouse for selection and
// commands. Translates user intent to Commands placed on the local command
// queue (which is what the deterministic tick consumes).

import type { Command } from "../sim/commands";
import { BUILDING_STATS, TILE, UNIT_STATS, type BuildingKind } from "../config";
import type { Building, EntityId, GameState, ResourceNode, Unit } from "../sim/state";
import { isBuilding, isResource, isUnit } from "../sim/state";
import type { Camera } from "../render/camera";

export interface InputEnv {
  canvas: HTMLCanvasElement;
  camera: Camera;
  state: () => GameState;
  myPlayerId: number;
  enqueue: (cmd: Command) => void;
  onSelectionChange: (sel: Set<EntityId>) => void;
  onBuildModeChange: (b: { building: BuildingKind } | null) => void;
  /** Escape: close HUD overlays (e.g. build menu) before clearing build mode / selection. */
  onEsc?: () => void;
  /** C / c with pawn selected: toggle build menu (if HUD wires it). */
  onToggleBuildMenu?: () => void;
  /** Left-click place with no available worker. */
  onCannotPlaceBuild?: () => void;
}

export interface InputState {
  selection: Set<EntityId>;
  // pending build placement
  buildMode: { building: BuildingKind } | null;
  // mouse
  mouseScreen: { x: number; y: number };
  mouseWorld: { x: number; y: number };
  hoverTile: { x: number; y: number };
  dragStart: { x: number; y: number } | null;
  dragCurrent: { x: number; y: number } | null;
  // keyboard pan
  keys: Set<string>;
}

export class Input {
  state: InputState = {
    selection: new Set(),
    buildMode: null,
    mouseScreen: { x: 0, y: 0 },
    mouseWorld: { x: 0, y: 0 },
    hoverTile: { x: 0, y: 0 },
    dragStart: null,
    dragCurrent: null,
    keys: new Set(),
  };

  // panning with middle button drag
  private panLastScreen: { x: number; y: number } | null = null;

  /** Pixels (canvas space): movement under this counts as a click, not a drag-box. */
  private static readonly CLICK_DRAG_THRESHOLD = 10;

  constructor(private env: InputEnv) {
    const c = env.canvas;
    // Some setups fire contextmenu without a clean button-2 mousedown; handle once here.
    c.addEventListener("contextmenu", this.onContextMenu);
    c.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("mouseup", this.onMouseUp);
    c.addEventListener("wheel", this.onWheel, { passive: false });
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  }

  destroy() {
    const c = this.env.canvas;
    c.removeEventListener("contextmenu", this.onContextMenu);
    c.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("mouseup", this.onMouseUp);
    c.removeEventListener("wheel", this.onWheel);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
  }

  /** Map CSS-pixel client coords to Pixi canvas / renderer pixel coords (fixes stretched canvas). */
  private clientToCanvas(clientX: number, clientY: number): { x: number; y: number } {
    const c = this.env.canvas;
    const rect = c.getBoundingClientRect();
    const rw = Math.max(rect.width, 1e-6);
    const rh = Math.max(rect.height, 1e-6);
    return {
      x: ((clientX - rect.left) / rw) * c.width,
      y: ((clientY - rect.top) / rh) * c.height,
    };
  }

  // call every frame to apply camera pan from keyboard
  tick(dt: number) {
    const cam = this.env.camera;
    const PAN_SPEED = 600 / cam.zoom;
    let dx = 0, dy = 0;
    if (this.state.keys.has("w") || this.state.keys.has("ArrowUp"))    dy -= 1;
    if (this.state.keys.has("s") || this.state.keys.has("ArrowDown"))  dy += 1;
    if (this.state.keys.has("a") || this.state.keys.has("ArrowLeft"))  dx -= 1;
    if (this.state.keys.has("d") || this.state.keys.has("ArrowRight")) dx += 1;
    // edge pan
    const m = this.state.mouseScreen, EDGE = 16;
    if (m.x < EDGE) dx -= 1;
    if (m.x > cam.vw - EDGE) dx += 1;
    if (m.y < EDGE) dy -= 1;
    if (m.y > cam.vh - EDGE) dy += 1;
    if (dx !== 0 || dy !== 0) {
      const len = Math.hypot(dx, dy) || 1;
      cam.pan((dx / len) * PAN_SPEED * dt, (dy / len) * PAN_SPEED * dt);
    }
    // refresh mouse-world (camera may have moved)
    const mw = cam.screenToWorld(m.x, m.y);
    this.state.mouseWorld = mw;
    this.state.hoverTile = { x: Math.floor(mw.x / TILE), y: Math.floor(mw.y / TILE) };
  }

  // ---------------- handlers ---------------------------------------------

  private onContextMenu = (ev: MouseEvent) => {
    ev.preventDefault();
    const { x: sx, y: sy } = this.clientToCanvas(ev.clientX, ev.clientY);
    this.state.mouseScreen = { x: sx, y: sy };
    this.issueRightClickAt(this.env.camera.screenToWorld(sx, sy));
  };

  private onMouseDown = (ev: MouseEvent) => {
    ev.preventDefault();
    const { x: sx, y: sy } = this.clientToCanvas(ev.clientX, ev.clientY);
    this.state.mouseScreen = { x: sx, y: sy };

    if (ev.button === 1) {
      // middle: pan
      this.panLastScreen = { x: sx, y: sy };
      return;
    }

    if (ev.button === 0) { // left
      // build placement?
      if (this.state.buildMode) {
        this.tryPlaceBuilding();
        // shift-click keeps build mode
        if (!ev.shiftKey) { this.state.buildMode = null; this.env.onBuildModeChange(null); }
        return;
      }
      // start drag selection
      this.state.dragStart = { x: sx, y: sy };
      this.state.dragCurrent = { x: sx, y: sy };
    }
    // Right-click commands: see onContextMenu (avoids duplicate + browser quirks).
  };

  private onMouseMove = (ev: MouseEvent) => {
    const c = this.env.canvas;
    const rect = c.getBoundingClientRect();
    const { x: sx, y: sy } = this.clientToCanvas(ev.clientX, ev.clientY);
    if (this.state.dragStart) this.state.dragCurrent = { x: sx, y: sy };
    // Only map to world when the cursor is over the canvas — moving over the DOM HUD
    // would otherwise corrupt hoverTile and break the build ghost preview.
    const inCanvas =
      ev.clientX >= rect.left && ev.clientX < rect.right &&
      ev.clientY >= rect.top && ev.clientY < rect.bottom;
    if (inCanvas) {
      this.state.mouseScreen = { x: sx, y: sy };
      const world = this.env.camera.screenToWorld(sx, sy);
      this.state.mouseWorld = world;
      this.state.hoverTile = { x: Math.floor(world.x / TILE), y: Math.floor(world.y / TILE) };
    }
    if (this.panLastScreen) {
      const dx = sx - this.panLastScreen.x, dy = sy - this.panLastScreen.y;
      this.env.camera.pan(-dx / this.env.camera.zoom, -dy / this.env.camera.zoom);
      this.panLastScreen = { x: sx, y: sy };
    }
  };

  private onMouseUp = (ev: MouseEvent) => {
    if (ev.button === 1) { this.panLastScreen = null; return; }
    if (ev.button !== 0) return;
    if (!this.state.dragStart || !this.state.dragCurrent) return;
    const start = this.state.dragStart, end = this.state.dragCurrent;
    const dragDist = Math.hypot(end.x - start.x, end.y - start.y);
    if (dragDist < Input.CLICK_DRAG_THRESHOLD) {
      this.singleSelect(end, ev.shiftKey);
    } else {
      this.boxSelect(start, end, ev.shiftKey);
    }
    this.state.dragStart = null;
    this.state.dragCurrent = null;
  };

  private onWheel = (ev: WheelEvent) => {
    ev.preventDefault();
    const { x: sx, y: sy } = this.clientToCanvas(ev.clientX, ev.clientY);
    const factor = Math.pow(1.0015, -ev.deltaY);
    this.env.camera.setZoom(this.env.camera.zoom * factor, { x: sx, y: sy });
  };

  private onKeyDown = (ev: KeyboardEvent) => {
    this.state.keys.add(ev.key);
    // hotkeys
    if (ev.key === "Escape") {
      this.env.onEsc?.();
      this.state.buildMode = null; this.env.onBuildModeChange(null);
      this.state.selection.clear(); this.env.onSelectionChange(this.state.selection);
    } else if (ev.key === " ") {
      // jump to first castle
      const s = this.env.state();
      for (const e of s.entities.values()) {
        if (isBuilding(e) && e.owner === this.env.myPlayerId && e.buildingKind === "castle") {
          this.env.camera.centerOn(e.pos.x, e.pos.y); break;
        }
      }
    }
    const hasPawn = this.hasPawnSelected();
    const hasAnyPawn = this.hasAnyOwnPawn();
    if ((ev.key === "c" || ev.key === "C")) {
      const t = ev.target as HTMLElement | null;
      const typing = !!(t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable));
      if (!typing) {
        this.env.onToggleBuildMenu?.();
        ev.preventDefault();
      }
    }
    if (hasAnyPawn) {
      const map: Record<string, BuildingKind> = {
        h: "house",
        p: "builder_house",
        f: "farm",
        d: "garden",
        b: "barracks",
        r: "archery",
        t: "tower",
        m: "monastery",
      };
      if (map[ev.key]) {
        this.state.buildMode = { building: map[ev.key] };
        this.env.onBuildModeChange(this.state.buildMode);
      }
    }
    // S = stop, A = attack-move (then click)
    if (ev.key === "s" && this.state.selection.size && !this.hasPawnSelected()) {
      this.env.enqueue({ kind: "stop", player: this.env.myPlayerId, unitIds: this.unitsInSelection() });
    }
  };
  private onKeyUp = (ev: KeyboardEvent) => { this.state.keys.delete(ev.key); };

  private hasAnyOwnPawn(): boolean {
    const s = this.env.state();
    for (const e of s.entities.values()) {
      if (isUnit(e) && e.unitKind === "pawn" && e.owner === this.env.myPlayerId) return true;
    }
    return false;
  }

  private hasPawnSelected(): boolean {
    const s = this.env.state();
    for (const id of this.state.selection) {
      const e = s.entities.get(id);
      if (isUnit(e) && e.unitKind === "pawn" && e.owner === this.env.myPlayerId) return true;
    }
    return false;
  }

  private unitsInSelection(): EntityId[] {
    const s = this.env.state();
    const out: EntityId[] = [];
    for (const id of this.state.selection) {
      const e = s.entities.get(id);
      if (isUnit(e) && e.owner === this.env.myPlayerId) out.push(e.id);
    }
    return out;
  }

  // ---------------- selection --------------------------------------------

  private singleSelect(screen: { x: number; y: number }, shift: boolean) {
    const world = this.env.camera.screenToWorld(screen.x, screen.y);
    const s = this.env.state();
    const picked = pickInteractiveTarget(s, world, this.env.myPlayerId);
    if (!shift) this.state.selection.clear();
    if (picked && isUnit(picked)) this.state.selection.add(picked.id);
    else if (picked && isBuilding(picked)) this.state.selection.add(picked.id);
    this.env.onSelectionChange(this.state.selection);
  }

  private boxSelect(a: { x: number; y: number }, b: { x: number; y: number }, shift: boolean) {
    const wa = this.env.camera.screenToWorld(Math.min(a.x, b.x), Math.min(a.y, b.y));
    const wb = this.env.camera.screenToWorld(Math.max(a.x, b.x), Math.max(a.y, b.y));
    const s = this.env.state();
    if (!shift) this.state.selection.clear();
    let anyOwn = false;
    for (const e of s.entities.values()) {
      if (!isUnit(e)) continue;
      if (e.pos.x >= wa.x && e.pos.x <= wb.x && e.pos.y >= wa.y && e.pos.y <= wb.y) {
        if (e.owner === this.env.myPlayerId) { this.state.selection.add(e.id); anyOwn = true; }
      }
    }
    // if none of mine in box, allow selecting enemy/neutral
    if (!anyOwn) {
      for (const e of s.entities.values()) {
        if (!isUnit(e)) continue;
        if (e.pos.x >= wa.x && e.pos.x <= wb.x && e.pos.y >= wa.y && e.pos.y <= wb.y) {
          this.state.selection.add(e.id);
        }
      }
    }
    this.env.onSelectionChange(this.state.selection);
  }

  // ---------------- right-click commands ---------------------------------

  /** Issue a move/attack/gather (etc.) at `world`. Kept separate so we can call from mouse or contextmenu. */
  private issueRightClickAt(world: { x: number; y: number }) {
    const s = this.env.state();
    const myUnits: EntityId[] = [];
    let trainingBldg: Building | null = null;
    for (const id of this.state.selection) {
      const e = s.entities.get(id);
      if (isUnit(e) && e.owner === this.env.myPlayerId) myUnits.push(e.id);
      if (isBuilding(e) && e.owner === this.env.myPlayerId) trainingBldg = e;
    }

    // If only a building is selected (no units): rally
    if (myUnits.length === 0 && trainingBldg) {
      this.env.enqueue({ kind: "rally", player: this.env.myPlayerId, buildingId: trainingBldg.id, target: world });
      return;
    }

    if (myUnits.length === 0) return;

    // What's under the cursor?
    const target = pickInteractiveTarget(s, world, this.env.myPlayerId);
    if (target) {
      if (isResource(target)) {
        // pawns gather; others attack-move there
        const pawnIds = myUnits.filter(id => { const u = s.entities.get(id); return isUnit(u) && u.unitKind === "pawn"; });
        const others = myUnits.filter(id => !pawnIds.includes(id));
        if (pawnIds.length) this.env.enqueue({ kind: "gather", player: this.env.myPlayerId, unitIds: pawnIds, nodeId: target.id });
        if (others.length) this.env.enqueue({ kind: "move", player: this.env.myPlayerId, unitIds: others, target: target.pos });
        return;
      }
      if (isUnit(target) && target.owner !== this.env.myPlayerId) {
        // monk → heal? only if target is friendly. Enemies → attack
        this.env.enqueue({ kind: "attackTarget", player: this.env.myPlayerId, unitIds: myUnits, targetId: target.id });
        return;
      }
      if (isUnit(target) && target.owner === this.env.myPlayerId) {
        const monks = myUnits.filter(id => { const u = s.entities.get(id); return isUnit(u) && u.unitKind === "monk"; });
        if (monks.length) this.env.enqueue({ kind: "heal", player: this.env.myPlayerId, unitIds: monks, targetId: target.id });
        const others = myUnits.filter(id => !monks.includes(id));
        if (others.length) this.env.enqueue({ kind: "move", player: this.env.myPlayerId, unitIds: others, target: target.pos });
        return;
      }
      if (isBuilding(target)) {
        if (target.owner !== this.env.myPlayerId) {
          this.env.enqueue({ kind: "attackTarget", player: this.env.myPlayerId, unitIds: myUnits, targetId: target.id });
          return;
        }
        // friendly building: if a pawn-built site, send pawns to assist; others move there
        const pawnIds = myUnits.filter(id => { const u = s.entities.get(id); return isUnit(u) && u.unitKind === "pawn"; });
        if (!target.built && pawnIds.length) {
          this.env.enqueue({ kind: "assistBuild", player: this.env.myPlayerId, pawnIds, siteId: target.id });
        }
        const others = myUnits.filter(id => !pawnIds.includes(id));
        if (others.length) this.env.enqueue({ kind: "move", player: this.env.myPlayerId, unitIds: others, target: target.pos });
        return;
      }
    }

    // Empty ground: move
    this.env.enqueue({ kind: "move", player: this.env.myPlayerId, unitIds: myUnits, target: world });
  }

  // ---------------- build placement --------------------------------------

  private tryPlaceBuilding() {
    if (!this.state.buildMode) return;
    const s = this.env.state();
    const stats = BUILDING_STATS[this.state.buildMode.building];
    const tile = {
      x: this.state.hoverTile.x - Math.floor(stats.width / 2),
      y: this.state.hoverTile.y - Math.floor(stats.height / 2),
    };
    const pawnIds: EntityId[] = [];
    for (const id of this.state.selection) {
      const e = s.entities.get(id);
      if (isUnit(e) && e.owner === this.env.myPlayerId && e.unitKind === "pawn") pawnIds.push(e.id);
    }
    const resolved = pawnIds.length ? pawnIds : resolveBuilderPawns(s, this.env.myPlayerId);
    if (!resolved.length) {
      this.env.onCannotPlaceBuild?.();
      return;
    }
    this.env.enqueue({
      kind: "buildPlace",
      player: this.env.myPlayerId,
      pawnIds: resolved,
      building: this.state.buildMode.building,
      tile,
    });
  }
}

function resolveBuilderPawns(s: GameState, myPlayerId: number): EntityId[] {
  const builders: EntityId[] = [];
  const any: EntityId[] = [];
  for (const e of s.entities.values()) {
    if (!isUnit(e) || e.owner !== myPlayerId || e.unitKind !== "pawn") continue;
    any.push(e.id);
    if (e.workerRole === "builder") builders.push(e.id);
  }
  return builders.length ? builders : any;
}

function distSq(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x, dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function unitPickRadius(u: Unit, localPlayerId?: number): number {
  const base = UNIT_STATS[u.unitKind].radius;
  // Pawns have a tall sprite; clicks near the castle often miss a small sim radius — use a generous foot circle.
  let r = u.unitKind === "pawn"
    ? Math.max(56, base * 2.75)
    : Math.max(42, base * 1.9);
  if (localPlayerId !== undefined && u.owner === localPlayerId) r *= 1.08;
  return r;
}

const PICK_EPS = 1e-4;

/** What the player is pointing at: units beat resources beat buildings; closest wins within type. */
export function pickInteractiveTarget(
  s: GameState,
  world: { x: number; y: number },
  localPlayerId?: number,
): Unit | ResourceNode | Building | null {
  let bestU: Unit | null = null;
  let bestUd = Infinity;
  for (const e of s.entities.values()) {
    if (!isUnit(e)) continue;
    const r = unitPickRadius(e, localPlayerId);
    const d2 = distSq(e.pos, world);
    if (d2 > r * r) continue;
    if (
      !bestU ||
      d2 < bestUd - PICK_EPS ||
      (Math.abs(d2 - bestUd) <= PICK_EPS && e.id < bestU.id)
    ) {
      bestUd = d2;
      bestU = e;
    }
  }
  if (bestU) return bestU;

  let bestR: ResourceNode | null = null;
  let bestRd = Infinity;
  for (const e of s.entities.values()) {
    if (!isResource(e)) continue;
    const r = e.nodeKind === "tree" ? 52 : e.nodeKind === "gold" ? 48 : 40;
    const d2 = distSq(e.pos, world);
    if (d2 > r * r) continue;
    if (
      !bestR ||
      d2 < bestRd - PICK_EPS ||
      (Math.abs(d2 - bestRd) <= PICK_EPS && e.id < bestR.id)
    ) {
      bestRd = d2;
      bestR = e;
    }
  }
  if (bestR) return bestR;

  let bestB: Building | null = null;
  let bestArea = Infinity;
  for (const e of s.entities.values()) {
    if (!isBuilding(e)) continue;
    const w = e.width * TILE, h = e.height * TILE;
    if (Math.abs(world.x - e.pos.x) < w / 2 && Math.abs(world.y - e.pos.y) < h / 2) {
      const area = w * h;
      if (area < bestArea) { bestArea = area; bestB = e; }
    }
  }
  return bestB;
}
