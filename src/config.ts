// Centralized game tuning. All numbers here participate in the deterministic
// simulation, so any change should be made before a match begins (or be agreed
// on by all peers when networked).

export const TILE = 64;            // world unit per tile (px at zoom 1)
export const SIM_HZ = 30;          // fixed simulation tick rate
export const SIM_DT = 1 / SIM_HZ;  // seconds per tick

/** Pawn deposit at castle/house: interact at door, hide "inside", emerge with empty hands. */
export const DEPOSIT = {
  interactSec: 0.22,
  hiddenSec: 0.46,   // total hidden = from interactSec to interactSec+hiddenSec
} as const;

export const MAP = {
  cols: 60,
  rows: 40,
} as const;

export const COLORS = {
  // team colors (hex - used for outlines, banners, etc.)
  blue: 0x3b82f6,
  red: 0xef4444,
  yellow: 0xeab308,
  purple: 0xa855f7,
  black: 0x1e293b,
  // UI palette
  parchment: 0xf5e9c8,
  parchmentDark: 0xc2a76a,
  woodDark: 0x3a2a14,
  woodMid: 0x6b4a25,
  shadow: 0x000000,
} as const;

export const TEAM_FOLDER: Record<TeamColor, string> = {
  blue: "blue",
  red: "red",
  yellow: "yellow",
  purple: "purple",
  black: "black",
};

export type TeamColor = "blue" | "red" | "yellow" | "purple" | "black";

// --- Unit stats ---------------------------------------------------------
export const UNIT_STATS = {
  pawn: {
    hp: 40, speed: 80, sight: 7 * TILE, radius: 16,
    attackDamage: 4, attackRange: 22, attackCooldown: 1.0,
    cost: { wood: 0, gold: 25, food: 1 },
    trainTime: 6,
    carryCapacity: 8,
    gatherTime: 0.7, // per resource unit
  },
  warrior: {
    hp: 100, speed: 78, sight: 7 * TILE, radius: 18,
    attackDamage: 14, attackRange: 28, attackCooldown: 0.95,
    cost: { wood: 25, gold: 30, food: 1 },
    trainTime: 9,
  },
  archer: {
    hp: 55, speed: 88, sight: 9 * TILE, radius: 16,
    attackDamage: 10, attackRange: 6 * TILE, attackCooldown: 1.4,
    cost: { wood: 35, gold: 25, food: 1 },
    trainTime: 9,
    projectileSpeed: 380,
  },
  lancer: {
    hp: 75, speed: 130, sight: 8 * TILE, radius: 20,
    attackDamage: 18, attackRange: 36, attackCooldown: 1.2,
    cost: { wood: 30, gold: 50, food: 2 },
    trainTime: 12,
  },
  monk: {
    hp: 60, speed: 80, sight: 7 * TILE, radius: 16,
    attackDamage: 0, attackRange: 0, attackCooldown: 0,
    healAmount: 14, healRange: 4 * TILE, healCooldown: 1.6,
    cost: { wood: 0, gold: 80, food: 1 },
    trainTime: 12,
  },
} as const;

// --- Building stats -----------------------------------------------------
export const BUILDING_STATS = {
  castle: {
    hp: 1500, sight: 9 * TILE,
    width: 4, height: 3,           // tiles
    cost: { wood: 400, gold: 200 },
    buildTime: 60,
    foodProvided: 6,
    trains: [] as const,
  },
  /** Housing: raises population cap (room for villagers & army). */
  house: {
    hp: 250, sight: 4 * TILE,
    width: 2, height: 2,
    cost: { wood: 65, gold: 0 },
    buildTime: 14,
    foodProvided: 6,
    trains: [] as const,
  },
  /** Trains pawns (builders / gatherers). */
  builder_house: {
    hp: 420, sight: 5 * TILE,
    width: 3, height: 2,
    cost: { wood: 95, gold: 35 },
    buildTime: 24,
    foodProvided: 0,
    trains: ["pawn"] as const,
  },
  /** Passive food income while built. */
  farm: {
    hp: 340, sight: 5 * TILE,
    width: 3, height: 2,
    cost: { wood: 85, gold: 15 },
    buildTime: 22,
    foodProvided: 0,
    trains: [] as const,
    passiveFoodPerSec: 0.42,
  },
  garden: {
    hp: 200, sight: 4 * TILE,
    width: 2, height: 2,
    cost: { wood: 40, gold: 0 },
    buildTime: 12,
    foodProvided: 0,
    trains: [] as const,
    passiveFoodPerSec: 0.14,
  },
  barracks: {
    hp: 600, sight: 5 * TILE,
    width: 3, height: 3,
    cost: { wood: 120, gold: 30 },
    buildTime: 24,
    foodProvided: 0,
    trains: ["warrior", "lancer"] as const,
  },
  archery: {
    hp: 500, sight: 6 * TILE,
    width: 3, height: 3,
    cost: { wood: 130, gold: 30 },
    buildTime: 22,
    foodProvided: 0,
    trains: ["archer"] as const,
  },
  monastery: {
    hp: 500, sight: 6 * TILE,
    width: 3, height: 4,
    cost: { wood: 100, gold: 100 },
    buildTime: 26,
    foodProvided: 0,
    trains: ["monk"] as const,
  },
  tower: {
    hp: 700, sight: 8 * TILE,
    width: 2, height: 3,
    cost: { wood: 80, gold: 60 },
    buildTime: 22,
    foodProvided: 0,
    trains: [] as const,
    // Tower auto-attacks
    attackDamage: 16, attackRange: 7 * TILE, attackCooldown: 1.4,
    projectileSpeed: 420,
  },
} as const;

export type UnitKind = keyof typeof UNIT_STATS;
export type BuildingKind = keyof typeof BUILDING_STATS;

export function buildingPassiveFoodPerSec(kind: BuildingKind): number {
  const s = BUILDING_STATS[kind] as { passiveFoodPerSec?: number };
  return s.passiveFoodPerSec ?? 0;
}

/** Built structures can level 1–5; upgrades take time and resources after placement. */
export const BUILDING_MAX_LEVEL = 5;

/** maxHp = round(baseHp * mult) for levels 1..5 */
export const BUILDING_LEVEL_HP_MULT = [1.0, 1.1, 1.22, 1.36, 1.52] as const;

/** Farm / garden passive food multiplier by level. */
export const BUILDING_LEVEL_INCOME_MULT = [1.0, 1.06, 1.14, 1.26, 1.4] as const;

/** Tower projectile damage multiplier by level. */
export const BUILDING_LEVEL_TOWER_DMG_MULT = [1.0, 1.1, 1.22, 1.36, 1.52] as const;

/**
 * Cost and time to advance one level. Index 0 = 1→2 (cheap), … index 3 = 4→5 (very expensive).
 */
export const BUILDING_LEVEL_UPGRADE = [
  { wood: 50, gold: 20, time: 10 },
  { wood: 110, gold: 48, time: 13 },
  { wood: 240, gold: 125, time: 19 },
  { wood: 520, gold: 300, time: 30 },
] as const;

export function buildingMaxHpForLevel(baseHp: number, level: number): number {
  const L = Math.max(1, Math.min(BUILDING_MAX_LEVEL, Math.floor(level)));
  return Math.max(1, Math.round(baseHp * BUILDING_LEVEL_HP_MULT[L - 1]));
}

export function buildingPassiveIncomeFactor(level: number): number {
  const L = Math.max(1, Math.min(BUILDING_MAX_LEVEL, Math.floor(level)));
  return BUILDING_LEVEL_INCOME_MULT[L - 1];
}

export function buildingTowerDamageFactor(level: number): number {
  const L = Math.max(1, Math.min(BUILDING_MAX_LEVEL, Math.floor(level)));
  return BUILDING_LEVEL_TOWER_DMG_MULT[L - 1];
}

export const STARTING_RESOURCES = { wood: 250, gold: 150, food: 0 } as const;
export const STARTING_POPULATION_CAP = 6; // before any houses

// Resource node yields
export const RESOURCE_NODES = {
  tree:  { kind: "tree" as const,  resource: "wood" as const, amount: 80,  radius: 18 },
  gold:  { kind: "gold" as const,  resource: "gold" as const, amount: 120, radius: 22 },
  sheep: { kind: "sheep" as const, resource: "food" as const, amount: 30,  radius: 16 },
} as const;

export type ResourceKind = "wood" | "gold" | "food";
