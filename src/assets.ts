// Asset manifest. Maps logical sprite names (and team colors) to file paths,
// frame layout, and animation timings. The loader splits each sheet into
// individual textures by frame so PixiJS can render any frame on demand.

import { Assets, Rectangle, Texture } from "pixi.js";
import type { TeamColor } from "./config";

const BASE = "/assets";

// Map color to folder slug used in copied paths
const C: Record<TeamColor, string> = {
  blue: "blue", red: "red", yellow: "yellow", purple: "purple", black: "black",
};

export interface AnimDef {
  url: string;
  frameW: number;
  frameH: number;
  frames: number;          // frames per row
  rows?: number;           // for grids; default 1
  fps: number;             // animation speed
  loop?: boolean;
}

export interface LoadedAnim {
  textures: Texture[];
  fps: number;
  loop: boolean;
  frameW: number;
  frameH: number;
}

// Per team-color, per unit-kind, per state -> AnimDef
function unitAnims(color: TeamColor) {
  const ufolder = `${C[color]}_units`;
  return {
    pawn: {
      idle:        { url: `${BASE}/units/${ufolder}/pawn/pawn_idle.png`,        frameW: 192, frameH: 192, frames: 8,  fps: 8,  loop: true },
      idle_wood:   { url: `${BASE}/units/${ufolder}/pawn/pawn_idle_wood.png`,   frameW: 192, frameH: 192, frames: 8,  fps: 8,  loop: true },
      idle_gold:   { url: `${BASE}/units/${ufolder}/pawn/pawn_idle_gold.png`,   frameW: 192, frameH: 192, frames: 8,  fps: 8,  loop: true },
      idle_meat:   { url: `${BASE}/units/${ufolder}/pawn/pawn_idle_meat.png`,   frameW: 192, frameH: 192, frames: 8,  fps: 8,  loop: true },
      idle_axe:    { url: `${BASE}/units/${ufolder}/pawn/pawn_idle_axe.png`,    frameW: 192, frameH: 192, frames: 8,  fps: 8,  loop: true },
      idle_pickaxe:{ url: `${BASE}/units/${ufolder}/pawn/pawn_idle_pickaxe.png`,frameW: 192, frameH: 192, frames: 8,  fps: 8,  loop: true },
      idle_hammer: { url: `${BASE}/units/${ufolder}/pawn/pawn_idle_hammer.png`, frameW: 192, frameH: 192, frames: 8,  fps: 8,  loop: true },
      run:         { url: `${BASE}/units/${ufolder}/pawn/pawn_run.png`,         frameW: 192, frameH: 192, frames: 6,  fps: 12, loop: true },
      run_wood:    { url: `${BASE}/units/${ufolder}/pawn/pawn_run_wood.png`,    frameW: 192, frameH: 192, frames: 6,  fps: 12, loop: true },
      run_gold:    { url: `${BASE}/units/${ufolder}/pawn/pawn_run_gold.png`,    frameW: 192, frameH: 192, frames: 6,  fps: 12, loop: true },
      run_meat:    { url: `${BASE}/units/${ufolder}/pawn/pawn_run_meat.png`,    frameW: 192, frameH: 192, frames: 6,  fps: 12, loop: true },
      run_axe:     { url: `${BASE}/units/${ufolder}/pawn/pawn_run_axe.png`,     frameW: 192, frameH: 192, frames: 6,  fps: 12, loop: true },
      run_pickaxe: { url: `${BASE}/units/${ufolder}/pawn/pawn_run_pickaxe.png`, frameW: 192, frameH: 192, frames: 6,  fps: 12, loop: true },
      run_hammer:  { url: `${BASE}/units/${ufolder}/pawn/pawn_run_hammer.png`,  frameW: 192, frameH: 192, frames: 6,  fps: 12, loop: true },
      interact_axe:    { url: `${BASE}/units/${ufolder}/pawn/pawn_interact_axe.png`,    frameW: 192, frameH: 192, frames: 6, fps: 10, loop: true },
      interact_pickaxe:{ url: `${BASE}/units/${ufolder}/pawn/pawn_interact_pickaxe.png`,frameW: 192, frameH: 192, frames: 6, fps: 10, loop: true },
      interact_hammer: { url: `${BASE}/units/${ufolder}/pawn/pawn_interact_hammer.png`, frameW: 192, frameH: 192, frames: 3, fps: 8,  loop: true },
      interact_knife:  { url: `${BASE}/units/${ufolder}/pawn/pawn_interact_knife.png`,  frameW: 192, frameH: 192, frames: 4, fps: 10, loop: true },
    },
    warrior: {
      idle:    { url: `${BASE}/units/${ufolder}/warrior/warrior_idle.png`,    frameW: 192, frameH: 192, frames: 8, fps: 8,  loop: true },
      run:     { url: `${BASE}/units/${ufolder}/warrior/warrior_run.png`,     frameW: 192, frameH: 192, frames: 6, fps: 12, loop: true },
      attack1: { url: `${BASE}/units/${ufolder}/warrior/warrior_attack1.png`, frameW: 192, frameH: 192, frames: 4, fps: 10, loop: true },
      attack2: { url: `${BASE}/units/${ufolder}/warrior/warrior_attack2.png`, frameW: 192, frameH: 192, frames: 4, fps: 10, loop: true },
      guard:   { url: `${BASE}/units/${ufolder}/warrior/warrior_guard.png`,   frameW: 192, frameH: 192, frames: 6, fps: 8,  loop: true },
    },
    archer: {
      idle:  { url: `${BASE}/units/${ufolder}/archer/archer_idle.png`,  frameW: 192, frameH: 192, frames: 6, fps: 8,  loop: true },
      run:   { url: `${BASE}/units/${ufolder}/archer/archer_run.png`,   frameW: 192, frameH: 192, frames: 4, fps: 12, loop: true },
      shoot: { url: `${BASE}/units/${ufolder}/archer/archer_shoot.png`, frameW: 192, frameH: 192, frames: 8, fps: 14, loop: true },
      arrow: { url: `${BASE}/units/${ufolder}/archer/arrow.png`,        frameW: 64,  frameH: 64,  frames: 1, fps: 1,  loop: false },
    },
    lancer: {
      idle:    { url: `${BASE}/units/${ufolder}/lancer/lancer_idle.png`,             frameW: 320, frameH: 320, frames: 12, fps: 8,  loop: true },
      run:     { url: `${BASE}/units/${ufolder}/lancer/lancer_run.png`,              frameW: 320, frameH: 320, frames: 6,  fps: 12, loop: true },
      attack:  { url: `${BASE}/units/${ufolder}/lancer/lancer_right_attack.png`,     frameW: 320, frameH: 320, frames: 3,  fps: 10, loop: true },
    },
    monk: {
      idle: { url: `${BASE}/units/${ufolder}/monk/idle.png`, frameW: 192, frameH: 192, frames: 6,  fps: 8,  loop: true },
      run:  { url: `${BASE}/units/${ufolder}/monk/run.png`,  frameW: 192, frameH: 192, frames: 4,  fps: 12, loop: true },
      heal: { url: `${BASE}/units/${ufolder}/monk/heal.png`, frameW: 192, frameH: 192, frames: 11, fps: 12, loop: true },
      heal_effect: { url: `${BASE}/units/${ufolder}/monk/heal_effect.png`, frameW: 192, frameH: 192, frames: 11, fps: 12, loop: false },
    },
  } as const;
}

export function buildingPaths(color: TeamColor) {
  const f = `${C[color]}_buildings`;
  return {
    castle:    `${BASE}/buildings/${f}/castle.png`,
    barracks:  `${BASE}/buildings/${f}/barracks.png`,
    archery:   `${BASE}/buildings/${f}/archery.png`,
    monastery: `${BASE}/buildings/${f}/monastery.png`,
    tower:     `${BASE}/buildings/${f}/tower.png`,
    house:     `${BASE}/buildings/${f}/house1.png`,
    /** Reuse variants for new kinds until dedicated art exists. */
    builder_house: `${BASE}/buildings/${f}/barracks.png`,
    farm:      `${BASE}/buildings/${f}/house2.png`,
    garden:    `${BASE}/buildings/${f}/house3.png`,
    house2:    `${BASE}/buildings/${f}/house2.png`,
    house3:    `${BASE}/buildings/${f}/house3.png`,
  } as const;
}

export const FX = {
  dust1:       { url: `${BASE}/particle_fx/dust_01.png`,        frameW: 64,  frameH: 64,  frames: 8,  fps: 18 },
  dust2:       { url: `${BASE}/particle_fx/dust_02.png`,        frameW: 64,  frameH: 64,  frames: 10, fps: 18 },
  fire1:       { url: `${BASE}/particle_fx/fire_01.png`,        frameW: 64,  frameH: 64,  frames: 8,  fps: 14 },
  fire2:       { url: `${BASE}/particle_fx/fire_02.png`,        frameW: 64,  frameH: 64,  frames: 10, fps: 14 },
  fire3:       { url: `${BASE}/particle_fx/fire_03.png`,        frameW: 64,  frameH: 64,  frames: 12, fps: 14 },
  explosion1:  { url: `${BASE}/particle_fx/explosion_01.png`,   frameW: 192, frameH: 192, frames: 8,  fps: 16 },
  explosion2:  { url: `${BASE}/particle_fx/explosion_02.png`,   frameW: 192, frameH: 192, frames: 10, fps: 16 },
  splash:      { url: `${BASE}/particle_fx/water_splash.png`,   frameW: 192, frameH: 192, frames: 9,  fps: 18 },
} as const;

export const TERRAIN = {
  tilemap1: `${BASE}/terrain/tileset/tilemap_color1.png`, // 576x384, 9x6 tiles of 64x64
  tilemap2: `${BASE}/terrain/tileset/tilemap_color2.png`,
  tilemap3: `${BASE}/terrain/tileset/tilemap_color3.png`,
  waterFoam: { url: `${BASE}/terrain/tileset/water_foam.png`, frameW: 192, frameH: 192, frames: 16, fps: 8 },
  waterBg: `${BASE}/terrain/tileset/water_background_color.png`,
  shadow: `${BASE}/terrain/tileset/shadow.png`,
} as const;

export const RESOURCES_ASSETS = {
  trees: [
    { url: `${BASE}/terrain/resources/wood/trees/tree1.png`, frameW: 192, frameH: 256, frames: 8, fps: 6 },
    { url: `${BASE}/terrain/resources/wood/trees/tree2.png`, frameW: 192, frameH: 256, frames: 8, fps: 6 },
    { url: `${BASE}/terrain/resources/wood/trees/tree3.png`, frameW: 192, frameH: 192, frames: 8, fps: 6 },
    { url: `${BASE}/terrain/resources/wood/trees/tree4.png`, frameW: 192, frameH: 192, frames: 8, fps: 6 },
  ],
  stumps: [
    `${BASE}/terrain/resources/wood/trees/stump_1.png`,
    `${BASE}/terrain/resources/wood/trees/stump_2.png`,
    `${BASE}/terrain/resources/wood/trees/stump_3.png`,
    `${BASE}/terrain/resources/wood/trees/stump_4.png`,
  ],
  goldStones: [
    `${BASE}/terrain/resources/gold/gold_stones/gold_stone_1.png`,
    `${BASE}/terrain/resources/gold/gold_stones/gold_stone_2.png`,
    `${BASE}/terrain/resources/gold/gold_stones/gold_stone_3.png`,
    `${BASE}/terrain/resources/gold/gold_stones/gold_stone_4.png`,
    `${BASE}/terrain/resources/gold/gold_stones/gold_stone_5.png`,
    `${BASE}/terrain/resources/gold/gold_stones/gold_stone_6.png`,
  ],
  goldResource: `${BASE}/terrain/resources/gold/gold_resource/gold_resource.png`,
  woodResource: `${BASE}/terrain/resources/wood/wood_resource/wood_resource.png`,
  meatResource: `${BASE}/terrain/resources/meat/meat_resource/meat_resource.png`,
  sheep: {
    idle: { url: `${BASE}/terrain/resources/meat/sheep/sheep_idle.png`, frameW: 128, frameH: 128, frames: 6, fps: 6 },
    move: { url: `${BASE}/terrain/resources/meat/sheep/sheep_move.png`, frameW: 128, frameH: 128, frames: 4, fps: 8 },
    grass:{ url: `${BASE}/terrain/resources/meat/sheep/sheep_grass.png`,frameW: 128, frameH: 128, frames: 12,fps: 8 },
  },
  bushes: [
    `${BASE}/terrain/decorations/bushes/bushe1.png`,
    `${BASE}/terrain/decorations/bushes/bushe2.png`,
    `${BASE}/terrain/decorations/bushes/bushe3.png`,
    `${BASE}/terrain/decorations/bushes/bushe4.png`,
  ],
  rocks: [
    `${BASE}/terrain/decorations/rocks/rock1.png`,
    `${BASE}/terrain/decorations/rocks/rock2.png`,
    `${BASE}/terrain/decorations/rocks/rock3.png`,
    `${BASE}/terrain/decorations/rocks/rock4.png`,
  ],
} as const;

export const UI_ASSETS = {
  iconWood: `${BASE}/terrain/resources/wood/wood_resource/wood_resource.png`,
  iconGold: `${BASE}/terrain/resources/gold/gold_resource/gold_resource.png`,
  iconFood: `${BASE}/terrain/resources/meat/meat_resource/meat_resource.png`,
  bannerSlots: `${BASE}/ui_elements/ui_elements/banners/banner_slots.png`,
  banner: `${BASE}/ui_elements/ui_elements/banners/banner.png`,
  smallBarBase: `${BASE}/ui_elements/ui_elements/bars/smallbar_base.png`,
  smallBarFill: `${BASE}/ui_elements/ui_elements/bars/smallbar_fill.png`,
  bigBarBase: `${BASE}/ui_elements/ui_elements/bars/bigbar_base.png`,
  bigBarFill: `${BASE}/ui_elements/ui_elements/bars/bigbar_fill.png`,
  bigBlueButton: `${BASE}/ui_elements/ui_elements/buttons/bigbluebutton_regular.png`,
  bigBlueButtonPressed: `${BASE}/ui_elements/ui_elements/buttons/bigbluebutton_pressed.png`,
  bigRedButton: `${BASE}/ui_elements/ui_elements/buttons/bigredbutton_regular.png`,
  bigRedButtonPressed: `${BASE}/ui_elements/ui_elements/buttons/bigredbutton_pressed.png`,
  smallBlueRound: `${BASE}/ui_elements/ui_elements/buttons/smallblueroundbutton_regular.png`,
  smallBlueSquare: `${BASE}/ui_elements/ui_elements/buttons/smallbluesquarebutton_regular.png`,
  cursor1: `${BASE}/ui_elements/ui_elements/cursors/cursor_01.png`,
  cursor2: `${BASE}/ui_elements/ui_elements/cursors/cursor_02.png`,
  cursor3: `${BASE}/ui_elements/ui_elements/cursors/cursor_03.png`,
  cursor4: `${BASE}/ui_elements/ui_elements/cursors/cursor_04.png`,
  paper: `${BASE}/ui_elements/ui_elements/papers/regularpaper.png`,
  paperSpecial: `${BASE}/ui_elements/ui_elements/papers/specialpaper.png`,
  woodTable: `${BASE}/ui_elements/ui_elements/wood_table/woodtable.png`,
  swords: `${BASE}/ui_elements/ui_elements/swords/swords.png`,
  ribbonsBig: `${BASE}/ui_elements/ui_elements/ribbons/bigribbons.png`,
  ribbonsSmall: `${BASE}/ui_elements/ui_elements/ribbons/smallribbons.png`,
  // icons (for build/train buttons)
  icons: Array.from({ length: 12 }, (_, i) => `${BASE}/ui_elements/ui_elements/icons/icon_${String(i + 1).padStart(2, "0")}.png`),
  avatars: Array.from({ length: 25 }, (_, i) => `${BASE}/ui_elements/ui_elements/human_avatars/avatars_${String(i + 1).padStart(2, "0")}.png`),
} as const;

// ---------------- Loader ------------------------------------------------

export interface AssetCache {
  // anim atlas keyed by url string
  anims: Map<string, LoadedAnim>;
  // single textures keyed by url
  textures: Map<string, Texture>;
  unitAnims: Record<TeamColor, ReturnType<typeof unitAnims>>;
  buildings: Record<TeamColor, Record<keyof ReturnType<typeof buildingPaths>, Texture>>;
}

async function loadAnim(def: AnimDef): Promise<LoadedAnim> {
  const sheet = await Assets.load(def.url) as Texture;
  const textures: Texture[] = [];
  const rows = def.rows ?? 1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < def.frames; c++) {
      const frame = new Rectangle(c * def.frameW, r * def.frameH, def.frameW, def.frameH);
      const t = new Texture({ source: sheet.source, frame });
      textures.push(t);
    }
  }
  return { textures, fps: def.fps, loop: def.loop ?? true, frameW: def.frameW, frameH: def.frameH };
}

export async function loadAllAssets(onProgress: (p: number) => void): Promise<AssetCache> {
  const anims = new Map<string, LoadedAnim>();
  const textures = new Map<string, Texture>();

  // Build a list of every asset we need to load.
  const animDefs: AnimDef[] = [];
  const textureUrls = new Set<string>();

  const teams: TeamColor[] = ["blue", "red", "yellow", "purple", "black"];
  const allUnitAnims: Record<TeamColor, ReturnType<typeof unitAnims>> = {} as any;
  for (const t of teams) {
    const ua = unitAnims(t);
    allUnitAnims[t] = ua;
    for (const k of Object.keys(ua) as (keyof typeof ua)[]) {
      const states = ua[k] as Record<string, AnimDef>;
      for (const stateName of Object.keys(states)) {
        const def = states[stateName];
        if (def.frames > 1) animDefs.push(def);
        else textureUrls.add(def.url);
      }
    }
  }

  // FX
  for (const k of Object.keys(FX) as (keyof typeof FX)[]) animDefs.push(FX[k] as AnimDef);

  // Terrain
  textureUrls.add(TERRAIN.tilemap1);
  textureUrls.add(TERRAIN.tilemap2);
  textureUrls.add(TERRAIN.tilemap3);
  textureUrls.add(TERRAIN.waterBg);
  textureUrls.add(TERRAIN.shadow);
  animDefs.push(TERRAIN.waterFoam as AnimDef);

  // Resources
  RESOURCES_ASSETS.trees.forEach(t => animDefs.push(t as AnimDef));
  RESOURCES_ASSETS.stumps.forEach(s => textureUrls.add(s));
  RESOURCES_ASSETS.goldStones.forEach(s => textureUrls.add(s));
  RESOURCES_ASSETS.bushes.forEach(s => textureUrls.add(s));
  RESOURCES_ASSETS.rocks.forEach(s => textureUrls.add(s));
  textureUrls.add(RESOURCES_ASSETS.goldResource);
  textureUrls.add(RESOURCES_ASSETS.woodResource);
  textureUrls.add(RESOURCES_ASSETS.meatResource);
  animDefs.push(RESOURCES_ASSETS.sheep.idle as AnimDef);
  animDefs.push(RESOURCES_ASSETS.sheep.move as AnimDef);
  animDefs.push(RESOURCES_ASSETS.sheep.grass as AnimDef);

  // Buildings (single textures)
  const buildings: any = {};
  for (const t of teams) {
    const paths = buildingPaths(t);
    buildings[t] = {};
    for (const k of Object.keys(paths) as (keyof typeof paths)[]) textureUrls.add(paths[k]);
  }

  // UI
  Object.values(UI_ASSETS).forEach(v => {
    if (typeof v === "string") textureUrls.add(v);
    else if (Array.isArray(v)) v.forEach(u => textureUrls.add(u));
  });

  const total = animDefs.length + textureUrls.size;
  let done = 0;
  const tick = () => { done++; onProgress(done / total); };

  // load in parallel
  await Promise.all([
    ...animDefs.map(async d => {
      const a = await loadAnim(d);
      anims.set(d.url, a);
      tick();
    }),
    ...[...textureUrls].map(async url => {
      const tex = await Assets.load(url) as Texture;
      textures.set(url, tex);
      tick();
    }),
  ]);

  // populate building textures
  for (const t of teams) {
    const paths = buildingPaths(t);
    buildings[t] = {} as any;
    for (const k of Object.keys(paths) as (keyof typeof paths)[]) {
      buildings[t][k] = textures.get(paths[k])!;
    }
  }

  return { anims, textures, unitAnims: allUnitAnims, buildings };
}
