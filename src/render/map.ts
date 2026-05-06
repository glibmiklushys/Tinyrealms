// Procedural map generation + tile rendering.
// Produces a deterministic map from a seed (so AI vs Player matches always
// share the same world, and a future netplay match can sync via seed).

import { Container, Graphics, Rectangle, Sprite, Texture, Ticker } from "pixi.js";
import type { AssetCache } from "../assets";
import { MAP, TILE } from "../config";
import { RNG } from "../sim/rng";

export interface MapData {
  cols: number;
  rows: number;
  // 0 = grass, 1 = water (impassable, decorative)
  cells: Uint8Array;
}

export function generateMap(seed: number): MapData {
  const rng = new RNG(seed ^ 0xa11ce);
  const cells = new Uint8Array(MAP.cols * MAP.rows);
  // Surround edges with a small water frame for visual interest.
  for (let y = 0; y < MAP.rows; y++) {
    for (let x = 0; x < MAP.cols; x++) {
      const i = y * MAP.cols + x;
      const nearEdge = x === 0 || y === 0 || x === MAP.cols - 1 || y === MAP.rows - 1;
      cells[i] = nearEdge && rng.chance(0.6) ? 1 : 0;
    }
  }
  // a small lake in a corner away from spawn points
  const lx = MAP.cols - 8, ly = MAP.rows - 8;
  for (let y = ly; y < ly + 5; y++) {
    for (let x = lx; x < lx + 6; x++) {
      if (Math.hypot(x - (lx + 2.5), y - (ly + 2)) < 3) cells[y * MAP.cols + x] = 1;
    }
  }
  return { cols: MAP.cols, rows: MAP.rows, cells };
}

// Tilemap_color1.png is 9x6 (576x384) at 64px per tile.
// We pick a few "grass" tiles randomly per cell. The pack is set up for
// auto-tiling, but for jam-speed we use a flat grass body and place a few
// flower/path tiles for variety.
function pickGrassFrame(rng: RNG): { col: number; row: number } {
  // Tilemap layout in this asset pack uses the inner 4-tile row of grass
  // (any of the bordered-by-grass cells render flat). Row 1 cols 1..3 are
  // the safe interior tiles. We mostly use one flat grass and sprinkle
  // a couple of detail tiles.
  if (rng.chance(0.94)) return { col: 1, row: 1 }; // flat grass
  if (rng.chance(0.5)) return { col: 2, row: 1 };
  return { col: 3, row: 1 };
}

export function buildMapLayer(map: MapData, cache: AssetCache, seed: number): Container {
  const layer = new Container();
  layer.label = "map";

  const tilemap = cache.textures.get("/assets/terrain/tileset/tilemap_color1.png")!;
  const waterBg = cache.textures.get("/assets/terrain/tileset/water_background_color.png")!;

  // Background water + grass body
  const rng = new RNG(seed ^ 0xbeef);

  // Draw water bg as one big tinted rect so we don't tile thousands of sprites
  const water = new Graphics();
  water.rect(0, 0, map.cols * TILE, map.rows * TILE).fill(0x4a7fb6);
  layer.addChild(water);

  // Grass body for each non-water cell — batch into one Graphics for perf
  const grass = new Graphics();
  for (let y = 0; y < map.rows; y++) {
    for (let x = 0; x < map.cols; x++) {
      const i = y * map.cols + x;
      if (map.cells[i] === 0) {
        grass.rect(x * TILE, y * TILE, TILE, TILE).fill(0x6cba4a);
      }
    }
  }
  layer.addChild(grass);

  // Sprinkle a few decorative grass-tile sprites from the tilemap
  // (cheap visual variety; only a few hundred sprites total)
  const variety = new Container();
  variety.label = "tile-variety";
  const VARIETY_FRAMES: Array<{col: number, row: number}> = [
    { col: 6, row: 0 }, // small grass tuft
    { col: 7, row: 0 },
    { col: 8, row: 0 },
    { col: 6, row: 1 },
  ];
  for (let y = 1; y < map.rows - 1; y++) {
    for (let x = 1; x < map.cols - 1; x++) {
      const i = y * map.cols + x;
      if (map.cells[i] !== 0) continue;
      if (rng.chance(0.05)) {
        const f = VARIETY_FRAMES[rng.int(0, VARIETY_FRAMES.length - 1)];
        const tex = new Texture({ source: tilemap.source, frame: new Rectangle(f.col * TILE, f.row * TILE, TILE, TILE) });
        const s = new Sprite(tex);
        s.x = x * TILE; s.y = y * TILE;
        variety.addChild(s);
      }
    }
  }
  layer.addChild(variety);
  void waterBg; void pickGrassFrame; void Ticker;
  return layer;
}
