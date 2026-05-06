// Simple deterministic AI. Runs as part of the simulation tick (so its
// behavior is the same on every peer once we have netplay). Issues commands
// to its own units exactly the way the human would.

import { BUILDING_STATS, TILE, UNIT_STATS } from "../config";
import type { Command } from "./commands";
import { vDist, vDistSq } from "./geom";
import type { Building, GameState, Player, ResourceNode, Unit, Vec2 } from "./state";
import { isBuilding, isResource, isUnit } from "./state";

export function aiThink(s: GameState): Command[] {
  const cmds: Command[] = [];
  for (const p of s.players) {
    if (p.isHuman || p.defeated) continue;
    if (s.time < p.ai.nextThinkAt) continue;
    p.ai.nextThinkAt = s.time + 1.0;

    const myCastle = findCastle(s, p.id);
    if (!myCastle) continue;

    const myPawns = collect(s, p.id, "pawn");
    const myWarriors = collect(s, p.id, "warrior");
    const myArchers = collect(s, p.id, "archer");
    const myArmy = [...myWarriors, ...myArchers, ...collect(s, p.id, "lancer")];
    const myBuildings = collectBuildings(s, p.id);

    // 1) put idle pawns to gather
    for (const pawn of myPawns) {
      if (pawn.task.kind === "idle") {
        const need = neededResource(p);
        const node = nearestResource(s, pawn.pos, need);
        if (node) cmds.push({ kind: "gather", player: p.id, unitIds: [pawn.id], nodeId: node.id });
      }
    }

    // 2) train pawns from a builder hall (castle no longer trains workers)
    const targetPawns = 8;
    const builderHall = myBuildings.find(b => b.built && b.buildingKind === "builder_house");
    if (
      builderHall &&
      myPawns.length < targetPawns &&
      builderHall.trainQueue.length < 2 &&
      p.resources.gold >= UNIT_STATS.pawn.cost.gold &&
      p.resources.food >= UNIT_STATS.pawn.cost.food &&
      p.population < p.populationCap
    ) {
      cmds.push({ kind: "train", player: p.id, buildingId: builderHall.id, unit: "pawn" });
    }

    // 3) build infrastructure when affordable
    const has = (k: keyof typeof BUILDING_STATS) => myBuildings.some(b => b.buildingKind === k);
    const countOf = (k: keyof typeof BUILDING_STATS) => myBuildings.filter(b => b.buildingKind === k).length;

    const placeNear = (kind: keyof typeof BUILDING_STATS) => {
      const stats = BUILDING_STATS[kind];
      if (p.resources.wood < stats.cost.wood || p.resources.gold < stats.cost.gold) return;
      const builder = myPawns.find(pp => pp.task.kind === "idle" || (pp.task.kind === "gather"));
      if (!builder) return;
      const slot = findBuildSpot(s, myCastle, stats.width, stats.height);
      if (!slot) return;
      cmds.push({ kind: "buildPlace", player: p.id, pawnIds: [builder.id], building: kind, tile: slot });
    };

    // build order
    if (!has("builder_house") && myPawns.length >= 2) placeNear("builder_house");
    if (!has("house") && p.resources.wood >= 60 && p.population >= p.populationCap - 1) placeNear("house");
    if (has("house") && countOf("farm") < 1 && myPawns.length >= 4 && p.resources.wood >= 85) placeNear("farm");
    if (countOf("garden") < 2 && myPawns.length >= 5 && p.resources.wood >= 40) placeNear("garden");
    if (!has("barracks") && myPawns.length >= 3) placeNear("barracks");
    if (!has("archery") && myPawns.length >= 4 && countOf("barracks") >= 1) placeNear("archery");
    if (countOf("tower") < 2 && myArmy.length >= 3 && p.resources.gold >= 80) placeNear("tower");
    if (myPawns.length >= 6 && countOf("house") < 3 && p.resources.wood >= 60 && p.population + 2 > p.populationCap) placeNear("house");

    // 4) train army units
    for (const b of myBuildings) {
      if (!b.built) continue;
      if (b.trainQueue.length >= 2) continue;
      if (b.buildingKind === "barracks" && p.resources.gold >= UNIT_STATS.warrior.cost.gold && p.resources.wood >= UNIT_STATS.warrior.cost.wood && p.population + 1 <= p.populationCap) {
        cmds.push({ kind: "train", player: p.id, buildingId: b.id, unit: "warrior" });
      }
      if (b.buildingKind === "archery" && p.resources.gold >= UNIT_STATS.archer.cost.gold && p.resources.wood >= UNIT_STATS.archer.cost.wood && p.population + 1 <= p.populationCap) {
        cmds.push({ kind: "train", player: p.id, buildingId: b.id, unit: "archer" });
      }
    }

    // 5) attack waves: when the army hits desiredArmy, push to enemy castle
    if (s.time >= p.ai.attackWaveAt && myArmy.length >= p.ai.desiredArmy) {
      const enemyCastle = findEnemyCastle(s, p);
      if (enemyCastle) {
        cmds.push({ kind: "attackMove", player: p.id, unitIds: myArmy.map(u => u.id), target: enemyCastle.pos });
        // schedule next wave with bigger army
        p.ai.attackWaveAt = s.time + 60;
        p.ai.desiredArmy = Math.min(20, p.ai.desiredArmy + 3);
      }
    }
  }
  return cmds;
}

function collect(s: GameState, owner: number, kind: Unit["unitKind"]): Unit[] {
  const out: Unit[] = [];
  for (const e of s.entities.values()) if (isUnit(e) && e.owner === owner && e.unitKind === kind) out.push(e);
  return out;
}
function collectBuildings(s: GameState, owner: number): Building[] {
  const out: Building[] = [];
  for (const e of s.entities.values()) if (isBuilding(e) && e.owner === owner) out.push(e);
  return out;
}
function findCastle(s: GameState, owner: number): Building | null {
  for (const e of s.entities.values()) if (isBuilding(e) && e.owner === owner && e.buildingKind === "castle") return e;
  return null;
}
function findEnemyCastle(s: GameState, me: Player): Building | null {
  for (const e of s.entities.values()) if (isBuilding(e) && e.buildingKind === "castle" && s.players[e.owner]?.team !== me.team) return e;
  return null;
}
function nearestResource(s: GameState, pos: Vec2, kind: ResourceNode["resource"]): ResourceNode | null {
  let best: ResourceNode | null = null; let bestD = Infinity;
  for (const e of s.entities.values()) {
    if (!isResource(e) || e.resource !== kind || e.amount <= 0) continue;
    const d = vDistSq(e.pos, pos);
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}
function neededResource(p: Player): "wood" | "gold" {
  if (p.resources.wood < 100) return "wood";
  if (p.resources.gold < 100) return "gold";
  return p.resources.wood < p.resources.gold * 1.4 ? "wood" : "gold";
}
function findBuildSpot(s: GameState, castle: Building, w: number, h: number): { x: number; y: number } | null {
  // spiral around the castle for a free tile patch
  const cx = castle.tile.x + Math.floor(castle.width / 2);
  const cy = castle.tile.y + Math.floor(castle.height / 2);
  for (let r = 4; r < 18; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const tx = cx + dx, ty = cy + dy;
        if (tx < 1 || ty < 1 || tx + w > 59 || ty + h > 39) continue;
        if (areaFree(s, tx, ty, w, h)) return { x: tx, y: ty };
      }
    }
  }
  return null;
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

