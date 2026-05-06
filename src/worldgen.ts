// Set up the initial world: place castles, resource nodes,
// decorative bushes/rocks. Deterministic from seed.

import { MAP, RESOURCE_NODES, TILE, type BuildingKind } from "./config";
import { spawnBuilding, spawnResource, spawnUnit } from "./sim/spawn";
import type { GameState } from "./sim/state";
import { isBuilding, isResource } from "./sim/state";
import type { Building } from "./sim/state";

export function setupMatch(s: GameState, seed: number) {
  const rng = s.rng;

  // 1) Place player castles in opposite corners
  const p1 = { x: 5, y: 5 };
  const p2 = { x: MAP.cols - 9, y: MAP.rows - 8 };
  const c1 = spawnBuilding(s, 0, "castle", p1, { built: true });
  const c2 = spawnBuilding(s, 1, "castle", p2, { built: true });

  const occupied = (tx: number, ty: number, pad = 1) => {
    for (const e of s.entities.values()) {
      if (isBuilding(e)) {
        if (tx >= e.tile.x - pad && tx < e.tile.x + e.width + pad && ty >= e.tile.y - pad && ty < e.tile.y + e.height + pad) return true;
      }
    }
    return false;
  };

  // 2) Resource nodes — before workers so gather tasks can target nodes
  for (let cluster = 0; cluster < 14; cluster++) {
    const cx = rng.int(3, MAP.cols - 4);
    const cy = rng.int(3, MAP.rows - 4);
    const count = rng.int(4, 9);
    for (let i = 0; i < count; i++) {
      const tx = cx + rng.int(-3, 3);
      const ty = cy + rng.int(-3, 3);
      if (tx < 1 || ty < 1 || tx >= MAP.cols - 1 || ty >= MAP.rows - 1) continue;
      if (occupied(tx, ty, 2)) continue;
      if (anyResourceAt(s, tx, ty, 1)) continue;
      const variant = rng.int(0, 3);
      spawnResource(s, "tree", { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE }, variant);
    }
  }

  const goldSpots = [
    { tx: 12, ty: 4 }, { tx: 4, ty: 13 },
    { tx: MAP.cols - 16, ty: MAP.rows - 6 }, { tx: MAP.cols - 6, ty: MAP.rows - 14 },
    { tx: 28, ty: 14 }, { tx: 32, ty: 24 },
  ];
  for (const g of goldSpots) {
    for (let i = 0; i < 5; i++) {
      const tx = g.tx + rng.int(-1, 1), ty = g.ty + rng.int(-1, 1);
      if (occupied(tx, ty, 2) || anyResourceAt(s, tx, ty, 1)) continue;
      spawnResource(s, "gold", { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE }, rng.int(0, 5));
    }
  }

  for (let i = 0; i < 12; i++) {
    const tx = rng.int(8, MAP.cols - 8);
    const ty = rng.int(4, MAP.rows - 4);
    if (occupied(tx, ty, 2) || anyResourceAt(s, tx, ty, 1)) continue;
    spawnResource(s, "sheep", { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE }, 0);
  }

  // 3) One miner, one lumberjack, one builder per side
  spawnStarterWorkers(s, 0, c1, 1);
  spawnStarterWorkers(s, 1, c2, -1);

  void seed;
  void RESOURCE_NODES;
  void p1; void p2;
  const _bk: BuildingKind = "castle"; void _bk;
}

function spawnStarterWorkers(s: GameState, owner: number, castle: Building, rowDir: number) {
  const y = castle.pos.y + rowDir * 80;
  const miner = spawnUnit(s, owner, "pawn", { x: castle.pos.x - 40, y }, { workerRole: "miner" });
  const lumber = spawnUnit(s, owner, "pawn", { x: castle.pos.x, y }, { workerRole: "lumber" });
  spawnUnit(s, owner, "pawn", { x: castle.pos.x + 40, y }, { workerRole: "builder" });

  const goldId = nearestResourceId(s, castle.pos, "gold");
  const treeId = nearestResourceId(s, castle.pos, "tree");
  if (goldId != null) {
    miner.task = { kind: "gather", nodeId: goldId, dropoffId: null, phase: "toNode" };
  }
  if (treeId != null) {
    lumber.task = { kind: "gather", nodeId: treeId, dropoffId: null, phase: "toNode" };
  }
}

function nearestResourceId(
  s: GameState,
  pos: { x: number; y: number },
  nodeKind: "gold" | "tree",
): number | null {
  let best: number | null = null;
  let bestD = Infinity;
  for (const e of s.entities.values()) {
    if (!isResource(e) || e.nodeKind !== nodeKind || e.amount <= 0) continue;
    const dx = e.pos.x - pos.x, dy = e.pos.y - pos.y;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = e.id;
    }
  }
  return best;
}

function anyResourceAt(s: GameState, tx: number, ty: number, pad = 0): boolean {
  for (const e of s.entities.values()) {
    if (e.kind !== "resource") continue;
    const rx = Math.floor(e.pos.x / TILE), ry = Math.floor(e.pos.y / TILE);
    if (Math.abs(rx - tx) <= pad && Math.abs(ry - ty) <= pad) return true;
  }
  return false;
}
