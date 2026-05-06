// Helpers for creating entities and inserting into the GameState.

import { BUILDING_STATS, RESOURCE_NODES, TILE, UNIT_STATS, type BuildingKind, type ResourceKind, type UnitKind } from "../config";
import type { Building, EntityId, GameState, PlayerId, Projectile, ResourceNode, Unit, Effect, Vec2, WorkerRole } from "./state";

function nextId(s: GameState): EntityId { return s.nextEntityId++; }

export function spawnUnit(
  s: GameState,
  owner: PlayerId,
  unitKind: UnitKind,
  pos: Vec2,
  opts?: { workerRole?: WorkerRole },
): Unit {
  const stats = UNIT_STATS[unitKind];
  const u: Unit = {
    id: nextId(s),
    kind: "unit",
    unitKind,
    owner,
    pos: { ...pos },
    vel: { x: 0, y: 0 },
    facing: 0,
    hp: stats.hp,
    maxHp: stats.hp,
    task: { kind: "idle" },
    attackCd: 0,
    carrying: null,
    workerRole: opts?.workerRole,
    animState: "idle",
    animTime: 0,
  };
  s.entities.set(u.id, u);
  const p = s.players[owner];
  if (p) p.population += unitKind === "lancer" ? 2 : 1;
  return u;
}

export function spawnBuilding(
  s: GameState,
  owner: PlayerId,
  buildingKind: BuildingKind,
  tile: { x: number; y: number },
  options: { built?: boolean } = {},
): Building {
  const stats = BUILDING_STATS[buildingKind];
  const b: Building = {
    id: nextId(s),
    kind: "building",
    buildingKind,
    owner,
    tile: { x: tile.x, y: tile.y },
    width: stats.width,
    height: stats.height,
    pos: { x: (tile.x + stats.width / 2) * TILE, y: (tile.y + stats.height / 2) * TILE },
    hp: options.built ? stats.hp : Math.max(1, Math.round(stats.hp * 0.1)),
    maxHp: stats.hp,
    built: options.built ?? false,
    buildProgress: options.built ? 1 : 0,
    rallyPoint: null,
    trainQueue: [],
    attackCd: 0,
    passiveFoodAcc: 0,
    level: 1,
    upgradeProgress: null,
  };
  s.entities.set(b.id, b);
  if (options.built) {
    const p = s.players[owner];
    if (p) p.populationCap += stats.foodProvided;
  }
  return b;
}

export function spawnResource(
  s: GameState,
  nodeKind: "tree" | "gold" | "sheep",
  pos: Vec2,
  variant: number,
): ResourceNode {
  const def = RESOURCE_NODES[nodeKind];
  const r: ResourceNode = {
    id: nextId(s),
    kind: "resource",
    nodeKind,
    resource: def.resource as ResourceKind,
    pos: { ...pos },
    amount: def.amount,
    initialAmount: def.amount,
    variant,
    graze: nodeKind === "sheep"
      ? { phase: "idle", t: 0, target: { ...pos } }
      : undefined,
  };
  s.entities.set(r.id, r);
  return r;
}

export function spawnProjectile(
  s: GameState, owner: PlayerId, pos: Vec2, vel: Vec2, damage: number, targetId: EntityId, source: "arrow" | "tower",
): Projectile {
  const p: Projectile = {
    id: nextId(s), kind: "projectile",
    owner, pos: { ...pos }, vel: { ...vel }, damage, targetId,
    ttl: 4, source,
  };
  s.entities.set(p.id, p);
  return p;
}

export function spawnEffect(s: GameState, effect: Effect["effect"], pos: Vec2, duration = 0.6): Effect {
  const e: Effect = { id: nextId(s), kind: "effect", effect, pos: { ...pos }, t: 0, duration };
  s.entities.set(e.id, e);
  return e;
}
