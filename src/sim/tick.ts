// The deterministic simulation step. Pure-ish: same (state, commands) → same
// next state. The renderer is read-only on the result.

import {
  BUILDING_LEVEL_UPGRADE,
  BUILDING_MAX_LEVEL,
  BUILDING_STATS,
  DEPOSIT,
  SIM_DT,
  TILE,
  UNIT_STATS,
  buildingMaxHpForLevel,
  buildingPassiveFoodPerSec,
  buildingPassiveIncomeFactor,
  buildingTowerDamageFactor,
} from "../config";
import type { Command } from "./commands";
import { clamp, vDist, vDistSq, vNorm, vSub } from "./geom";
import { spawnEffect, spawnProjectile, spawnUnit } from "./spawn";
import type { Building, EntityId, GameState, Player, PlayerId, ResourceNode, Unit, Vec2 } from "./state";
// (ResourceNode used in nearestResourceOfKind)
import { isBuilding, isProjectile, isResource, isUnit } from "./state";

// ---------------- Helpers ------------------------------------------------

function getEntity(s: GameState, id: EntityId) { return s.entities.get(id); }

function isHostile(s: GameState, a: { owner: PlayerId }, b: { owner: PlayerId }): boolean {
  const pa = s.players[a.owner], pb = s.players[b.owner];
  return !!pa && !!pb && pa.team !== pb.team;
}

function unitFootprint(u: Unit): number { return UNIT_STATS[u.unitKind].radius; }

/** South-facing door of a drop-off building (castle / house), in world px. */
function dropoffDoorPos(b: Building): Vec2 {
  const h = b.height * TILE;
  return { x: b.pos.x, y: b.pos.y + h / 2 - 16 };
}

/** Step outside after depositing — spread so workers don't stack. */
function dropoffExitPos(b: Building, unitId: number): Vec2 {
  const h = b.height * TILE;
  const spread = ((unitId % 7) - 3) * 16;
  return { x: b.pos.x + spread, y: b.pos.y + h / 2 + 26 };
}

function dropoffLeaveTarget(b: Building, unitId: number): Vec2 {
  const h = b.height * TILE;
  const spread = ((unitId % 7) - 3) * 18;
  return { x: b.pos.x + spread, y: b.pos.y + h / 2 + 52 };
}

function nearestDropoff(s: GameState, u: Unit): Building | null {
  let best: Building | null = null;
  let bestD = Infinity;
  for (const e of s.entities.values()) {
    if (!isBuilding(e) || e.owner !== u.owner || !e.built) continue;
    if (e.buildingKind !== "castle" && e.buildingKind !== "house") continue;
    const d = vDistSq(e.pos, u.pos);
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}

function findNearbyEnemy(s: GameState, u: Unit, range: number): Unit | Building | null {
  let best: Unit | Building | null = null;
  let bestD = range * range;
  for (const e of s.entities.values()) {
    if (!isUnit(e) && !isBuilding(e)) continue;
    if (!isHostile(s, u, e)) continue;
    const d = vDistSq(e.pos, u.pos);
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}

function setAnim(u: Unit, state: Unit["animState"]) {
  if (u.animState !== state) { u.animState = state; u.animTime = 0; }
}

// Cost helpers
function canAfford(p: Player, cost: { wood?: number; gold?: number; food?: number }): boolean {
  return (
    p.resources.wood >= (cost.wood ?? 0) &&
    p.resources.gold >= (cost.gold ?? 0) &&
    p.resources.food >= (cost.food ?? 0)
  );
}
function pay(p: Player, cost: { wood?: number; gold?: number; food?: number }) {
  p.resources.wood -= cost.wood ?? 0;
  p.resources.gold -= cost.gold ?? 0;
  p.resources.food -= cost.food ?? 0;
}
function refund(p: Player, cost: { wood?: number; gold?: number; food?: number }) {
  p.resources.wood += cost.wood ?? 0;
  p.resources.gold += cost.gold ?? 0;
  p.resources.food += cost.food ?? 0;
}

// Find a free spawn slot near a building
function findSpawnNearBuilding(s: GameState, b: Building): Vec2 {
  const cx = b.pos.x, cy = b.pos.y;
  const r = (Math.max(b.width, b.height) * TILE) / 2 + 24;
  for (let attempt = 0; attempt < 16; attempt++) {
    const ang = (attempt / 16) * Math.PI * 2;
    const x = clamp(cx + Math.cos(ang) * (r + 8), 16, s.mapW - 16);
    const y = clamp(cy + Math.sin(ang) * (r + 8), 16, s.mapH - 16);
    return { x, y };
  }
  return { x: cx + r, y: cy };
}

// ---------------- Command processing -------------------------------------

function processCommand(s: GameState, cmd: Command) {
  const p = s.players[cmd.player];
  if (!p || p.defeated) return;
  switch (cmd.kind) {
    case "move": {
      // spread movement targets a bit so units don't pile on one point
      cmd.unitIds.forEach((id, i) => {
        const u = s.entities.get(id);
        if (!isUnit(u) || u.owner !== p.id) return;
        const offsetAngle = (i / Math.max(1, cmd.unitIds.length)) * Math.PI * 2;
        const off = Math.min(40 + cmd.unitIds.length * 2, 80);
        u.task = { kind: "move", target: { x: cmd.target.x + Math.cos(offsetAngle) * off * 0.3, y: cmd.target.y + Math.sin(offsetAngle) * off * 0.3 } };
        u.carrying = u.unitKind === "pawn" ? u.carrying : null;
      });
      break;
    }
    case "attackMove": {
      cmd.unitIds.forEach(id => {
        const u = s.entities.get(id);
        if (!isUnit(u) || u.owner !== p.id) return;
        u.task = { kind: "attackMove", target: { ...cmd.target } };
      });
      break;
    }
    case "attackTarget": {
      cmd.unitIds.forEach(id => {
        const u = s.entities.get(id);
        if (!isUnit(u) || u.owner !== p.id) return;
        const t = s.entities.get(cmd.targetId);
        if (!t || (!isUnit(t) && !isBuilding(t))) return;
        u.task = { kind: "attack", targetId: t.id, lastSeenAt: { ...t.pos } };
      });
      break;
    }
    case "stop":
    case "hold": {
      cmd.unitIds.forEach(id => {
        const u = s.entities.get(id);
        if (!isUnit(u) || u.owner !== p.id) return;
        u.task = { kind: "idle" };
        u.vel.x = 0; u.vel.y = 0;
      });
      break;
    }
    case "gather": {
      const node = s.entities.get(cmd.nodeId);
      if (!isResource(node)) return;
      cmd.unitIds.forEach(id => {
        const u = s.entities.get(id);
        if (!isUnit(u) || u.owner !== p.id || u.unitKind !== "pawn") return;
        u.task = { kind: "gather", nodeId: node.id, dropoffId: null, phase: "toNode" };
      });
      break;
    }
    case "buildPlace": {
      const stats = BUILDING_STATS[cmd.building];
      if (!canAfford(p, stats.cost)) return;
      // verify tile placement is on map and not overlapping anything
      if (cmd.tile.x < 0 || cmd.tile.y < 0) return;
      if (cmd.tile.x + stats.width > 60 || cmd.tile.y + stats.height > 40) return;
      if (!isAreaFree(s, cmd.tile.x, cmd.tile.y, stats.width, stats.height)) return;
      pay(p, stats.cost);
      // create site
      // dynamic import-like avoidance: we call spawnBuilding directly
      const b = spawnBuildingInline(s, p.id, cmd.building, cmd.tile);
      // assign first available pawn
      cmd.pawnIds.forEach(pid => {
        const u = s.entities.get(pid);
        if (!isUnit(u) || u.owner !== p.id || u.unitKind !== "pawn") return;
        u.task = { kind: "build", siteId: b.id };
      });
      break;
    }
    case "assistBuild": {
      const site = s.entities.get(cmd.siteId);
      if (!isBuilding(site) || site.built || site.owner !== p.id) return;
      cmd.pawnIds.forEach(pid => {
        const u = s.entities.get(pid);
        if (!isUnit(u) || u.owner !== p.id || u.unitKind !== "pawn") return;
        u.task = { kind: "build", siteId: site.id };
      });
      break;
    }
    case "heal": {
      cmd.unitIds.forEach(id => {
        const u = s.entities.get(id);
        if (!isUnit(u) || u.owner !== p.id || u.unitKind !== "monk") return;
        u.task = { kind: "heal", targetId: cmd.targetId };
      });
      break;
    }
    case "train": {
      const b = s.entities.get(cmd.buildingId);
      if (!isBuilding(b) || b.owner !== p.id || !b.built) return;
      const allowed = (BUILDING_STATS[b.buildingKind].trains as readonly string[]).includes(cmd.unit);
      if (!allowed) return;
      const stats = UNIT_STATS[cmd.unit];
      if (!canAfford(p, stats.cost)) return;
      // population-capped
      if (p.population + (cmd.unit === "lancer" ? 2 : 1) > p.populationCap) return;
      pay(p, stats.cost);
      b.trainQueue.push({ unit: cmd.unit, remaining: stats.trainTime, total: stats.trainTime });
      break;
    }
    case "cancelTrain": {
      const b = s.entities.get(cmd.buildingId);
      if (!isBuilding(b) || b.owner !== p.id) return;
      const item = b.trainQueue[cmd.index];
      if (!item) return;
      b.trainQueue.splice(cmd.index, 1);
      refund(p, UNIT_STATS[item.unit].cost);
      break;
    }
    case "rally": {
      const b = s.entities.get(cmd.buildingId);
      if (!isBuilding(b) || b.owner !== p.id) return;
      b.rallyPoint = { ...cmd.target };
      break;
    }
    case "upgradeBuilding": {
      const b = s.entities.get(cmd.buildingId);
      if (!isBuilding(b) || b.owner !== p.id || !b.built) return;
      if (b.level >= BUILDING_MAX_LEVEL || b.upgradeProgress != null) return;
      const up = BUILDING_LEVEL_UPGRADE[b.level - 1];
      if (!up) return;
      if (!canAfford(p, up)) return;
      pay(p, up);
      b.upgradeProgress = 0;
      break;
    }
  }
}

function spawnBuildingInline(s: GameState, owner: PlayerId, kind: keyof typeof BUILDING_STATS, tile: { x: number; y: number }) {
  const stats = BUILDING_STATS[kind];
  const b: Building = {
    id: s.nextEntityId++, kind: "building", buildingKind: kind, owner,
    tile: { x: tile.x, y: tile.y }, width: stats.width, height: stats.height,
    pos: { x: (tile.x + stats.width / 2) * TILE, y: (tile.y + stats.height / 2) * TILE },
    hp: Math.max(1, Math.round(stats.hp * 0.1)),
    maxHp: stats.hp,
    built: false,
    buildProgress: 0,
    rallyPoint: null,
    trainQueue: [],
    attackCd: 0,
    passiveFoodAcc: 0,
    level: 1,
    upgradeProgress: null,
  };
  s.entities.set(b.id, b);
  return b;
}

function isAreaFree(s: GameState, tx: number, ty: number, w: number, h: number): boolean {
  for (const e of s.entities.values()) {
    if (isBuilding(e)) {
      if (rectsOverlap(tx, ty, w, h, e.tile.x, e.tile.y, e.width, e.height)) return false;
    } else if (isResource(e)) {
      const rx = Math.floor(e.pos.x / TILE), ry = Math.floor(e.pos.y / TILE);
      if (rx >= tx && rx < tx + w && ry >= ty && ry < ty + h) return false;
    }
  }
  return true;
}

function rectsOverlap(ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

// ---------------- Per-tick updates ---------------------------------------

function updateUnits(s: GameState) {
  for (const e of s.entities.values()) {
    if (!isUnit(e)) continue;
    updateUnit(s, e);
  }
}

function moveTowards(u: Unit, target: Vec2, speed: number, dt: number): boolean {
  const dx = target.x - u.pos.x, dy = target.y - u.pos.y;
  const d = Math.hypot(dx, dy);
  if (d < 2) { u.vel.x = 0; u.vel.y = 0; return true; }
  const nx = dx / d, ny = dy / d;
  const step = Math.min(d, speed * dt);
  u.vel.x = nx * speed; u.vel.y = ny * speed;
  u.pos.x += nx * step; u.pos.y += ny * step;
  u.facing = Math.atan2(ny, nx);
  return false;
}

// avoid units overlapping by pushing apart slightly each tick
function separateUnits(s: GameState) {
  const units: Unit[] = [];
  for (const e of s.entities.values()) if (isUnit(e)) units.push(e);
  for (let i = 0; i < units.length; i++) {
    for (let j = i + 1; j < units.length; j++) {
      const a = units[i], b = units[j];
      const dx = b.pos.x - a.pos.x, dy = b.pos.y - a.pos.y;
      const minD = unitFootprint(a) + unitFootprint(b);
      const d2 = dx * dx + dy * dy;
      if (d2 > 1 && d2 < minD * minD) {
        const d = Math.sqrt(d2);
        const overlap = (minD - d) * 0.5;
        const nx = dx / d, ny = dy / d;
        a.pos.x -= nx * overlap * 0.5;
        a.pos.y -= ny * overlap * 0.5;
        b.pos.x += nx * overlap * 0.5;
        b.pos.y += ny * overlap * 0.5;
      }
    }
  }
}

function clampToMap(s: GameState, p: Vec2) {
  p.x = clamp(p.x, 8, s.mapW - 8);
  p.y = clamp(p.y, 8, s.mapH - 8);
}

function damage(s: GameState, target: Unit | Building, amount: number, attacker?: Unit) {
  target.hp -= amount;
  if (target.hp <= 0) {
    onDeath(s, target);
    if (attacker && attacker.task.kind === "attack" && attacker.task.targetId === target.id) {
      attacker.task = { kind: "idle" };
    }
  }
}

function onDeath(s: GameState, e: Unit | Building) {
  const owner = s.players[e.owner];
  if (isUnit(e)) {
    if (owner) owner.population -= e.unitKind === "lancer" ? 2 : 1;
    spawnEffect(s, "dust", e.pos, 0.5);
  } else {
    if (owner) owner.populationCap = Math.max(0, owner.populationCap - BUILDING_STATS[e.buildingKind].foodProvided);
    spawnEffect(s, "explosion", e.pos, 0.8);
  }
  s.entities.delete(e.id);
}

function updateUnit(s: GameState, u: Unit) {
  const stats = UNIT_STATS[u.unitKind];
  u.attackCd = Math.max(0, u.attackCd - SIM_DT);
  u.animTime += SIM_DT;

  // automatic acquisition of nearby enemies if idle
  if (u.task.kind === "idle" && u.unitKind !== "pawn" && u.unitKind !== "monk") {
    const enemy = findNearbyEnemy(s, u, stats.sight);
    if (enemy) u.task = { kind: "attack", targetId: enemy.id, lastSeenAt: { ...enemy.pos } };
  }

  switch (u.task.kind) {
    case "idle": setAnim(u, "idle"); u.vel.x = 0; u.vel.y = 0; break;

    case "move": {
      const arrived = moveTowards(u, u.task.target, stats.speed, SIM_DT);
      setAnim(u, "run");
      if (arrived) u.task = { kind: "idle" };
      break;
    }

    case "attackMove": {
      // engage anything hostile in sight, otherwise walk to target
      const enemy = findNearbyEnemy(s, u, stats.sight);
      if (enemy) {
        u.task = { kind: "attack", targetId: enemy.id, lastSeenAt: { ...enemy.pos } };
      } else {
        const arrived = moveTowards(u, u.task.target, stats.speed, SIM_DT);
        setAnim(u, "run");
        if (arrived) u.task = { kind: "idle" };
      }
      break;
    }

    case "attack": {
      const target = s.entities.get(u.task.targetId);
      if (!target || (!isUnit(target) && !isBuilding(target))) {
        u.task = { kind: "idle" };
        break;
      }
      // re-acquire memory
      u.task.lastSeenAt = { ...target.pos };
      const range = stats.attackRange;
      const d = vDist(u.pos, target.pos);
      if (d > range) {
        moveTowards(u, target.pos, stats.speed, SIM_DT);
        setAnim(u, "run");
      } else {
        u.vel.x = 0; u.vel.y = 0;
        u.facing = Math.atan2(target.pos.y - u.pos.y, target.pos.x - u.pos.x);
        setAnim(u, "attack");
        if (u.attackCd <= 0) {
          u.attackCd = stats.attackCooldown;
          if (u.unitKind === "archer") {
            const dir = vNorm(vSub(target.pos, u.pos));
            const proj = (UNIT_STATS as any).archer.projectileSpeed ?? 380;
            spawnProjectile(s, u.owner, { x: u.pos.x, y: u.pos.y - 8 }, { x: dir.x * proj, y: dir.y * proj }, stats.attackDamage, target.id, "arrow");
          } else {
            damage(s, target, stats.attackDamage, u);
          }
        }
      }
      break;
    }

    case "gather": {
      const node = s.entities.get(u.task.nodeId);
      if (!isResource(node) || node.amount <= 0) {
        // node depleted → look for nearest same kind
        const found = nearestResourceOfKind(s, u.pos, isResource(node) ? node.nodeKind : "tree");
        if (found) u.task = { kind: "gather", nodeId: found.id, dropoffId: u.task.dropoffId, phase: "toNode" };
        else u.task = { kind: "idle" };
        break;
      }
      if (u.task.phase === "toNode") {
        const arrived = moveTowards(u, node.pos, stats.speed, SIM_DT);
        setAnim(u, "run");
        if (arrived || vDist(u.pos, node.pos) < 28) {
          u.task = { ...u.task, phase: "harvest" };
          (u as any)._harvestT = 0;
        }
      } else if (u.task.phase === "harvest") {
        u.vel.x = 0; u.vel.y = 0;
        u.facing = Math.atan2(node.pos.y - u.pos.y, node.pos.x - u.pos.x);
        setAnim(u, "interact");
        (u as any)._harvestT = ((u as any)._harvestT ?? 0) + SIM_DT;
        if ((u as any)._harvestT >= UNIT_STATS.pawn.gatherTime) {
          (u as any)._harvestT = 0;
          const take = 1;
          if (node.amount > 0) {
            node.amount -= take;
            u.carrying = { resource: node.resource, amount: (u.carrying?.amount ?? 0) + take };
          }
          if ((u.carrying?.amount ?? 0) >= UNIT_STATS.pawn.carryCapacity || node.amount <= 0) {
            const drop = nearestDropoff(s, u);
            if (drop) u.task = { kind: "gather", nodeId: node.id, dropoffId: drop.id, phase: "toDoor" };
            else u.task = { kind: "idle" };
          }
        }
      } else if (u.task.phase === "toDoor") {
        const drop = u.task.dropoffId != null ? s.entities.get(u.task.dropoffId) : undefined;
        if (!isBuilding(drop)) { u.task = { kind: "idle" }; break; }
        const door = dropoffDoorPos(drop);
        const arrived = moveTowards(u, door, stats.speed, SIM_DT);
        setAnim(u, "run");
        if (arrived || vDist(u.pos, door) < 16) {
          u.pos.x = door.x;
          u.pos.y = door.y;
          u.task = { kind: "gather", nodeId: u.task.nodeId, dropoffId: drop.id, phase: "depositing", depositT: 0 };
        }
      } else if (u.task.phase === "depositing") {
        const drop = u.task.dropoffId != null ? s.entities.get(u.task.dropoffId) : undefined;
        if (!isBuilding(drop)) { u.task = { kind: "idle" }; break; }
        const t = (u.task.depositT ?? 0) + SIM_DT;
        u.task = { kind: "gather", nodeId: u.task.nodeId, dropoffId: drop.id, phase: "depositing", depositT: t };
        u.facing = Math.atan2(drop.pos.y - u.pos.y, drop.pos.x - u.pos.x);
        const hiddenEnd = DEPOSIT.interactSec + DEPOSIT.hiddenSec;
        if (t < DEPOSIT.interactSec) {
          u.vel.x = 0; u.vel.y = 0;
          setAnim(u, "interact");
        } else if (t < hiddenEnd) {
          u.vel.x = 0; u.vel.y = 0;
          setAnim(u, "idle");
        } else {
          if (u.carrying) {
            const owner = s.players[u.owner];
            if (owner) (owner.resources as any)[u.carrying.resource] += u.carrying.amount;
            u.carrying = null;
          }
          const exit = dropoffExitPos(drop, u.id);
          u.pos.x = exit.x;
          u.pos.y = exit.y;
          u.task = { kind: "gather", nodeId: u.task.nodeId, dropoffId: drop.id, phase: "leavingDoor" };
        }
      } else if (u.task.phase === "leavingDoor") {
        const drop = u.task.dropoffId != null ? s.entities.get(u.task.dropoffId) : undefined;
        if (!isBuilding(drop)) { u.task = { kind: "idle" }; break; }
        const far = dropoffLeaveTarget(drop, u.id);
        const arrived = moveTowards(u, far, stats.speed, SIM_DT);
        setAnim(u, "run");
        if (arrived || vDist(u.pos, far) < 14) {
          const node = s.entities.get(u.task.nodeId);
          if (isResource(node) && node.amount > 0) {
            u.task = { kind: "gather", nodeId: node.id, dropoffId: drop.id, phase: "toNode" };
          } else {
            const nk = isResource(node) ? node.nodeKind : "tree";
            const found = nearestResourceOfKind(s, u.pos, nk);
            if (found) u.task = { kind: "gather", nodeId: found.id, dropoffId: drop.id, phase: "toNode" };
            else u.task = { kind: "idle" };
          }
        }
      }
      break;
    }

    case "build": {
      const site = s.entities.get(u.task.siteId);
      if (!isBuilding(site) || site.built) { u.task = { kind: "idle" }; break; }
      const targetPos: Vec2 = { x: site.pos.x, y: site.pos.y };
      const d = vDist(u.pos, targetPos);
      if (d > (Math.max(site.width, site.height) * TILE) / 2 + 8) {
        moveTowards(u, targetPos, stats.speed, SIM_DT);
        setAnim(u, "run");
      } else {
        u.vel.x = 0; u.vel.y = 0;
        u.facing = Math.atan2(site.pos.y - u.pos.y, site.pos.x - u.pos.x);
        setAnim(u, "interact");
        const total = BUILDING_STATS[site.buildingKind].buildTime;
        const dprog = SIM_DT / total;
        site.buildProgress = clamp(site.buildProgress + dprog, 0, 1);
        site.hp = Math.max(site.hp, Math.round(site.maxHp * (0.1 + 0.9 * site.buildProgress)));
        if (site.buildProgress >= 1) {
          site.built = true;
          site.level = site.level ?? 1;
          site.maxHp = buildingMaxHpForLevel(BUILDING_STATS[site.buildingKind].hp, site.level);
          site.hp = site.maxHp;
          const owner = s.players[site.owner];
          if (owner) owner.populationCap += BUILDING_STATS[site.buildingKind].foodProvided;
          u.task = { kind: "idle" };
        }
      }
      break;
    }

    case "heal": {
      if (u.unitKind !== "monk") { u.task = { kind: "idle" }; break; }
      const t = s.entities.get(u.task.targetId);
      if (!isUnit(t)) { u.task = { kind: "idle" }; break; }
      const range = (UNIT_STATS.monk as any).healRange;
      const d = vDist(u.pos, t.pos);
      if (d > range) {
        moveTowards(u, t.pos, stats.speed, SIM_DT);
        setAnim(u, "run");
      } else {
        u.vel.x = 0; u.vel.y = 0; u.facing = Math.atan2(t.pos.y - u.pos.y, t.pos.x - u.pos.x);
        setAnim(u, "heal");
        if (u.attackCd <= 0) {
          u.attackCd = (UNIT_STATS.monk as any).healCooldown;
          t.hp = Math.min(t.maxHp, t.hp + (UNIT_STATS.monk as any).healAmount);
          spawnEffect(s, "heal", t.pos, 0.6);
        }
      }
      break;
    }
  }

  clampToMap(s, u.pos);
}

function nearestResourceOfKind(s: GameState, p: Vec2, kind: ResourceNode["nodeKind"]): ResourceNode | null {
  let best: ResourceNode | null = null; let bestD = Infinity;
  for (const e of s.entities.values()) {
    if (!isResource(e) || e.nodeKind !== kind || e.amount <= 0) continue;
    const d = vDistSq(e.pos, p);
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}

function finishBuildingUpgrade(_s: GameState, b: Building) {
  const stats = BUILDING_STATS[b.buildingKind];
  const oldMax = b.maxHp;
  b.level += 1;
  const newMax = buildingMaxHpForLevel(stats.hp, b.level);
  const ratio = b.hp / Math.max(1, oldMax);
  b.maxHp = newMax;
  b.hp = clamp(Math.round(newMax * ratio), 1, newMax);
  b.upgradeProgress = null;
}

function updateBuildings(s: GameState) {
  for (const e of s.entities.values()) {
    if (!isBuilding(e)) continue;
    e.attackCd = Math.max(0, e.attackCd - SIM_DT);
    if (!e.built) continue;

    if (e.upgradeProgress != null) {
      const up = BUILDING_LEVEL_UPGRADE[e.level - 1];
      if (!up) {
        e.upgradeProgress = null;
      } else {
        e.upgradeProgress = Math.min(1, e.upgradeProgress + SIM_DT / up.time);
        if (e.upgradeProgress >= 1) finishBuildingUpgrade(s, e);
      }
    }

    const rate = buildingPassiveFoodPerSec(e.buildingKind) * buildingPassiveIncomeFactor(e.level);
    if (rate > 0) {
      const owner = s.players[e.owner];
      if (owner) {
        e.passiveFoodAcc = (e.passiveFoodAcc ?? 0) + rate * SIM_DT;
        const whole = Math.floor(e.passiveFoodAcc);
        if (whole > 0) {
          owner.resources.food += whole;
          e.passiveFoodAcc! -= whole;
        }
      }
    }
    // tower attacks
    if (e.buildingKind === "tower") {
      const range = (BUILDING_STATS.tower as any).attackRange;
      const enemy = findNearbyEnemyForBuilding(s, e, range);
      if (enemy && e.attackCd <= 0) {
        e.attackCd = (BUILDING_STATS.tower as any).attackCooldown;
        const dir = vNorm(vSub(enemy.pos, e.pos));
        const speed = (BUILDING_STATS.tower as any).projectileSpeed;
        const baseDmg = (BUILDING_STATS.tower as any).attackDamage as number;
        const dmg = Math.max(1, Math.round(baseDmg * buildingTowerDamageFactor(e.level)));
        spawnProjectile(s, e.owner, { x: e.pos.x, y: e.pos.y - 24 }, { x: dir.x * speed, y: dir.y * speed }, dmg, enemy.id, "tower");
      }
    }
    // production
    if (e.trainQueue.length > 0) {
      const head = e.trainQueue[0];
      head.remaining = Math.max(0, head.remaining - SIM_DT);
      if (head.remaining <= 0) {
        // try to spawn unit (respect pop cap; if over, hold and refund slot)
        const owner = s.players[e.owner];
        const popCost = head.unit === "lancer" ? 2 : 1;
        if (!owner || owner.population + popCost > owner.populationCap) {
          // hold — wait until cap allows
          head.remaining = 0;
          continue;
        }
        const spawn = findSpawnNearBuilding(s, e);
        const unit = spawnUnit(s, e.owner, head.unit, spawn);
        if (e.rallyPoint) unit.task = { kind: "move", target: { ...e.rallyPoint } };
        e.trainQueue.shift();
      }
    }
  }
}

function findNearbyEnemyForBuilding(s: GameState, b: Building, range: number): Unit | Building | null {
  let best: Unit | Building | null = null; let bestD = range * range;
  for (const e of s.entities.values()) {
    if (!isUnit(e) && !isBuilding(e)) continue;
    if (!isHostile(s, b, e)) continue;
    const d = vDistSq(e.pos, b.pos);
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}

function updateProjectiles(s: GameState) {
  const toRemove: EntityId[] = [];
  for (const e of s.entities.values()) {
    if (!isProjectile(e)) continue;
    e.ttl -= SIM_DT;
    if (e.ttl <= 0) { toRemove.push(e.id); continue; }
    e.pos.x += e.vel.x * SIM_DT;
    e.pos.y += e.vel.y * SIM_DT;
    const tgt = s.entities.get(e.targetId);
    if (tgt && (isUnit(tgt) || isBuilding(tgt))) {
      const d = vDistSq(e.pos, tgt.pos);
      if (d < 22 * 22) {
        damage(s, tgt, e.damage);
        spawnEffect(s, "splash", e.pos, 0.4);
        toRemove.push(e.id);
      }
    } else {
      // target gone — let projectile fly out then die
    }
  }
  toRemove.forEach(id => s.entities.delete(id));
}

function updateEffects(s: GameState) {
  const toRemove: EntityId[] = [];
  for (const e of s.entities.values()) {
    if (e.kind !== "effect") continue;
    e.t += SIM_DT;
    if (e.t >= e.duration) toRemove.push(e.id);
  }
  toRemove.forEach(id => s.entities.delete(id));
}

function updateResources(s: GameState) {
  // sheep wandering
  const toRemove: EntityId[] = [];
  for (const e of s.entities.values()) {
    if (!isResource(e)) continue;
    if (e.amount <= 0) {
      // tree → stump (still rendered), but for simplicity we just remove
      toRemove.push(e.id);
      continue;
    }
    if (e.nodeKind === "sheep" && e.graze) {
      e.graze.t += SIM_DT;
      if (e.graze.phase === "idle" && e.graze.t > 2) {
        e.graze.phase = "move"; e.graze.t = 0;
        e.graze.target = { x: e.pos.x + s.rng.range(-40, 40), y: e.pos.y + s.rng.range(-40, 40) };
      } else if (e.graze.phase === "move") {
        const dx = e.graze.target.x - e.pos.x, dy = e.graze.target.y - e.pos.y;
        const d = Math.hypot(dx, dy);
        if (d < 4 || e.graze.t > 4) { e.graze.phase = "graze"; e.graze.t = 0; }
        else { e.pos.x += (dx / d) * 18 * SIM_DT; e.pos.y += (dy / d) * 18 * SIM_DT; }
      } else if (e.graze.phase === "graze" && e.graze.t > 3) {
        e.graze.phase = "idle"; e.graze.t = 0;
      }
    }
  }
  toRemove.forEach(id => s.entities.delete(id));
}

function checkVictory(s: GameState) {
  if (s.outcome.over) return;
  // a player is defeated if they have no castle
  for (const p of s.players) {
    if (p.defeated) continue;
    let hasCastle = false;
    for (const e of s.entities.values()) {
      if (isBuilding(e) && e.owner === p.id && e.buildingKind === "castle") { hasCastle = true; break; }
    }
    if (!hasCastle) p.defeated = true;
  }
  const aliveTeams = new Set<number>();
  for (const p of s.players) if (!p.defeated) aliveTeams.add(p.team);
  if (aliveTeams.size === 1) {
    const winnerTeam = [...aliveTeams][0];
    const winner = s.players.find(pp => pp.team === winnerTeam) ?? null;
    s.outcome = { winner: winner?.id ?? null, over: true };
  }
}

// ---------------- Public tick --------------------------------------------

export function runTick(s: GameState, commands: Command[]) {
  for (const cmd of commands) processCommand(s, cmd);
  updateUnits(s);
  separateUnits(s);
  updateBuildings(s);
  updateProjectiles(s);
  updateResources(s);
  updateEffects(s);
  checkVictory(s);
  s.tick++;
  s.time = s.tick * SIM_DT;
}
