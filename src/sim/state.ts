// The complete game state. Designed to be:
//   - Serializable (only plain data, no functions/classes besides RNG)
//   - Deterministically updated by tick.ts using a queue of Commands
//   - Identical across any peers running the same seed + command stream

import { TILE, MAP, STARTING_RESOURCES, STARTING_POPULATION_CAP, type BuildingKind, type ResourceKind, type TeamColor, type UnitKind } from "../config";
import { RNG } from "./rng";

export type EntityId = number;
export type PlayerId = number;

/** Starting specialist workers (same pawn unit; role drives default job + idle sprite). */
export type WorkerRole = "miner" | "lumber" | "builder";

export interface Vec2 { x: number; y: number; }

export type UnitTask =
  | { kind: "idle" }
  | { kind: "move"; target: Vec2 }
  // attack a specific entity (chase-and-engage)
  | { kind: "attack"; targetId: EntityId; lastSeenAt: Vec2 }
  // attack-move: walk to target, engage anything hostile in sight along the way
  | { kind: "attackMove"; target: Vec2 }
  // pawn: collect from a resource node, then return to drop-off, then loop
  | { kind: "gather"; nodeId: EntityId; dropoffId: EntityId | null; phase: "toNode" | "harvest" | "toDoor" | "depositing" | "leavingDoor"; depositT?: number }
  // pawn: walk to construction site and build until done
  | { kind: "build"; siteId: EntityId }
  // monk: heal a friendly entity in range
  | { kind: "heal"; targetId: EntityId };

export interface Unit {
  id: EntityId;
  kind: "unit";
  unitKind: UnitKind;
  owner: PlayerId;
  pos: Vec2;
  vel: Vec2;
  facing: number;          // radians; 0 = right
  hp: number;
  maxHp: number;
  task: UnitTask;
  attackCd: number;        // seconds until next attack
  // pawn-only
  carrying: { resource: ResourceKind; amount: number } | null;
  workerRole?: WorkerRole;
  // animation hint (renderer-only — but kept in sim for replay/multiplayer parity)
  animState: "idle" | "run" | "attack" | "interact" | "heal";
  animTime: number;        // seconds since animState changed
}

export interface Building {
  id: EntityId;
  kind: "building";
  buildingKind: BuildingKind;
  owner: PlayerId;
  pos: Vec2;               // center, in pixels
  tile: { x: number; y: number };  // top-left in tile coords
  width: number;           // tiles
  height: number;          // tiles
  hp: number;
  maxHp: number;
  built: boolean;
  buildProgress: number;   // 0..1
  rallyPoint: Vec2 | null;
  trainQueue: { unit: UnitKind; remaining: number; total: number }[];
  attackCd: number;
  /** Farm / garden: fractional accumulator for passive food (deterministic). */
  passiveFoodAcc?: number;
  /** 1..5 after built; higher levels boost HP, farm/garden output, tower damage. */
  level: number;
  /** 0..1 while upgrading to the next level; null when idle. */
  upgradeProgress: number | null;
}

export interface ResourceNode {
  id: EntityId;
  kind: "resource";
  nodeKind: "tree" | "gold" | "sheep";
  resource: ResourceKind;
  pos: Vec2;
  amount: number;
  initialAmount: number;
  // sheep-only: small wandering, brief idle->graze cycle
  graze?: { phase: "idle" | "move" | "graze"; t: number; target: Vec2 };
  variant: number; // pick which sprite (0..n)
}

export interface Projectile {
  id: EntityId;
  kind: "projectile";
  owner: PlayerId;
  pos: Vec2;
  vel: Vec2;
  damage: number;
  targetId: EntityId;      // homing toward this entity
  ttl: number;
  source: "arrow" | "tower";
}

export interface Effect {
  id: EntityId;
  kind: "effect";
  effect: "explosion" | "dust" | "heal" | "splash" | "fire";
  pos: Vec2;
  t: number;     // elapsed seconds
  duration: number;
}

export type Entity = Unit | Building | ResourceNode | Projectile | Effect;

export interface Player {
  id: PlayerId;
  name: string;
  color: TeamColor;
  team: number;     // 0 or 1
  isHuman: boolean;
  defeated: boolean;

  resources: { wood: number; gold: number; food: number };
  population: number;
  populationCap: number;
  // AI brain state (only used if !isHuman) — kept here so it's also deterministic
  ai: AIState;
}

export interface AIState {
  // simple finite-state goals; not perfect, but a fair sparring partner
  nextThinkAt: number;
  attackWaveAt: number;     // game time when AI will push
  desiredArmy: number;
  knownEnemyHQ: Vec2 | null;
}

export interface GameState {
  tick: number;
  time: number;            // seconds (= tick / SIM_HZ)
  rng: RNG;
  nextEntityId: EntityId;

  players: Player[];
  // entities stored in a single map for easy lookup; iteration order is insertion order
  entities: Map<EntityId, Entity>;

  // map width/height in pixels
  mapW: number;
  mapH: number;

  outcome: { winner: PlayerId | null; over: boolean };
}

export function makeInitialState(seed: number): GameState {
  const rng = new RNG(seed);
  return {
    tick: 0,
    time: 0,
    rng,
    nextEntityId: 1,
    players: [],
    entities: new Map(),
    mapW: MAP.cols * TILE,
    mapH: MAP.rows * TILE,
    outcome: { winner: null, over: false },
  };
}

export function makePlayer(id: PlayerId, name: string, color: TeamColor, team: number, isHuman: boolean): Player {
  return {
    id, name, color, team, isHuman, defeated: false,
    resources: { ...STARTING_RESOURCES },
    population: 0,
    populationCap: STARTING_POPULATION_CAP,
    ai: { nextThinkAt: 5, attackWaveAt: 90, desiredArmy: 6, knownEnemyHQ: null },
  };
}

// Convenience type-guards
export const isUnit = (e: Entity | undefined): e is Unit => !!e && e.kind === "unit";
export const isBuilding = (e: Entity | undefined): e is Building => !!e && e.kind === "building";
export const isResource = (e: Entity | undefined): e is ResourceNode => !!e && e.kind === "resource";
export const isProjectile = (e: Entity | undefined): e is Projectile => !!e && e.kind === "projectile";
export const isEffect = (e: Entity | undefined): e is Effect => !!e && e.kind === "effect";
