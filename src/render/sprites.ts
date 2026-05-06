// Renderer-side sprite tracking. The renderer is read-only over the sim:
// every frame it reconciles the set of rendered sprites with the entities
// in GameState (add new, update transforms, remove dead).

import { Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import type { AssetCache, LoadedAnim } from "../assets";
import { RESOURCES_ASSETS, FX } from "../assets";
import { BUILDING_STATS, COLORS, DEPOSIT, TILE, type BuildingKind } from "../config";
import type { Building, Effect, EntityId, GameState, Projectile, ResourceNode, Unit } from "../sim/state";
import { isBuilding, isEffect, isProjectile, isResource, isUnit } from "../sim/state";

interface UnitSprite {
  root: Container;
  body: Sprite;
  shadow: Sprite;
  selectionRing: Graphics;
  hpBg: Graphics;
  hpFg: Graphics;
  carry: Sprite;
  carryLabel: Text;
  currentAnim: LoadedAnim | null;
  currentKey: string;
  flip: boolean;
}

interface BuildingSprite {
  root: Container;
  body: Sprite;
  selection: Graphics;
  hpBg: Graphics;
  hpFg: Graphics;
  buildOverlay: Graphics;
  fire: Sprite | null;
}

interface ResourceSprite {
  root: Container;
  body: Sprite;
  shadow: Sprite | null;
  currentAnim: LoadedAnim | null;
  variant: number;
}

interface ProjectileSprite { root: Sprite; }

interface EffectSprite {
  root: Sprite;
  anim: LoadedAnim;
  loop: boolean;
}

export class SpriteWorld {
  units = new Map<EntityId, UnitSprite>();
  buildings = new Map<EntityId, BuildingSprite>();
  resources = new Map<EntityId, ResourceSprite>();
  projectiles = new Map<EntityId, ProjectileSprite>();
  effects = new Map<EntityId, EffectSprite>();

  // Layered containers for proper z-sorting:
  // 0: ground (decals)  — added by map.ts
  // 1: shadows
  // 2: resources / buildings / units sorted by y
  // 3: projectiles
  // 4: effects
  shadowLayer = new Container();
  entityLayer = new Container();
  projLayer = new Container();
  effectLayer = new Container();

  selection = new Set<EntityId>();

  constructor(private cache: AssetCache) {
    this.shadowLayer.label = "shadows";
    this.entityLayer.label = "entities";
    this.projLayer.label = "projectiles";
    this.effectLayer.label = "effects";
    this.entityLayer.sortableChildren = true;
  }

  addToWorld(parent: Container) {
    parent.addChild(this.shadowLayer);
    parent.addChild(this.entityLayer);
    parent.addChild(this.projLayer);
    parent.addChild(this.effectLayer);
  }

  setSelection(ids: Iterable<EntityId>) {
    this.selection = new Set(ids);
  }

  reconcile(state: GameState) {
    // mark-and-sweep: track which sprites we still need
    const seenU = new Set<EntityId>();
    const seenB = new Set<EntityId>();
    const seenR = new Set<EntityId>();
    const seenP = new Set<EntityId>();
    const seenE = new Set<EntityId>();

    for (const e of state.entities.values()) {
      if (isUnit(e)) { seenU.add(e.id); this.upsertUnit(e); }
      else if (isBuilding(e)) { seenB.add(e.id); this.upsertBuilding(e, state); }
      else if (isResource(e)) { seenR.add(e.id); this.upsertResource(e); }
      else if (isProjectile(e)) { seenP.add(e.id); this.upsertProjectile(e); }
      else if (isEffect(e)) { seenE.add(e.id); this.upsertEffect(e); }
    }

    // remove stale
    for (const [id, s] of this.units) if (!seenU.has(id)) { s.root.destroy({ children: true }); s.shadow.destroy(); this.units.delete(id); }
    for (const [id, s] of this.buildings) if (!seenB.has(id)) { s.root.destroy({ children: true }); this.buildings.delete(id); }
    for (const [id, s] of this.resources) if (!seenR.has(id)) { s.root.destroy({ children: true }); if (s.shadow) s.shadow.destroy(); this.resources.delete(id); }
    for (const [id, s] of this.projectiles) if (!seenP.has(id)) { s.root.destroy(); this.projectiles.delete(id); }
    for (const [id, s] of this.effects) if (!seenE.has(id)) { s.root.destroy(); this.effects.delete(id); }
  }

  // ---------- per-entity reconcilers --------------------------------------

  private upsertUnit(u: Unit) {
    let s = this.units.get(u.id);
    if (!s) {
      const root = new Container();
      const shadow = new Sprite(this.cache.textures.get("/assets/terrain/tileset/shadow.png")!);
      shadow.anchor.set(0.5, 0.5);
      shadow.scale.set(0.35, 0.18);
      shadow.alpha = 0.45;
      this.shadowLayer.addChild(shadow);

      const body = new Sprite();
      body.anchor.set(0.5, 0.78);

      const selectionRing = new Graphics();
      const hpBg = new Graphics();
      const hpFg = new Graphics();
      const carry = new Sprite();
      carry.anchor.set(0.5, 0.5);
      carry.visible = false;

      const carryLabel = new Text({
        text: "",
        style: {
          fontFamily: "Segoe UI, system-ui, sans-serif",
          fontSize: 13,
          fontWeight: "700",
          fill: 0xf5e9c8,
          stroke: { color: 0x1a120a, width: 4 },
        },
      });
      carryLabel.anchor.set(0.5, 1);
      carryLabel.visible = false;

      root.addChild(selectionRing);
      root.addChild(body);
      root.addChild(carry);
      root.addChild(carryLabel);
      root.addChild(hpBg);
      root.addChild(hpFg);
      this.entityLayer.addChild(root);

      s = { root, body, shadow, selectionRing, hpBg, hpFg, carry, carryLabel, currentAnim: null, currentKey: "", flip: false };
      this.units.set(u.id, s);
    }

    // pick animation key based on unitKind + animState + carry
    const key = pickUnitAnimKey(u);
    if (key !== s.currentKey) {
      const def = (this.cache.unitAnims as any)[playerColor(u.owner)][u.unitKind][key.split("/")[1]] as { url: string } | undefined;
      const anim = def ? this.cache.anims.get(def.url) ?? null : null;
      s.currentAnim = anim;
      s.currentKey = key;
      if (anim && anim.textures.length > 0) s.body.texture = anim.textures[0];
    }
    if (s.currentAnim && s.currentAnim.textures.length > 0) {
      const a = s.currentAnim;
      const idx = Math.floor(u.animTime * a.fps) % a.textures.length;
      s.body.texture = a.textures[idx];
    }

    // facing
    const wantFlip = Math.cos(u.facing) < -0.05;
    if (wantFlip !== s.flip) {
      s.flip = wantFlip;
      s.body.scale.x = wantFlip ? -1 : 1;
    }

    s.root.x = u.pos.x; s.root.y = u.pos.y;
    s.root.zIndex = u.pos.y + 1;
    s.shadow.x = u.pos.x; s.shadow.y = u.pos.y + 8;

    // selection ring & HP bar
    const selected = this.selection.has(u.id);
    s.selectionRing.clear();
    if (selected) {
      const radius = 22;
      s.selectionRing
        .ellipse(0, 6, radius, radius * 0.45)
        .stroke({ width: 2, color: COLORS.parchment, alpha: 0.9 });
    }

    // HP bar (only when damaged or selected)
    s.hpBg.clear(); s.hpFg.clear();
    if (u.hp < u.maxHp || selected) {
      const w = 36, h = 4;
      s.hpBg.roundRect(-w / 2, -42, w, h, 1).fill({ color: 0x000000, alpha: 0.6 });
      const ratio = Math.max(0, u.hp / u.maxHp);
      const col = playerHpColor(u.owner);
      s.hpFg.roundRect(-w / 2, -42, w * ratio, h, 1).fill({ color: col, alpha: 0.95 });
    }

    // carrying icon + amount for pawns
    const depositHidden = isPawnDepositHidden(u);
    if (u.unitKind === "pawn" && u.carrying && u.carrying.amount > 0 && !depositHidden) {
      const tex = this.cache.textures.get(
        u.carrying.resource === "wood" ? RESOURCES_ASSETS.woodResource :
        u.carrying.resource === "gold" ? RESOURCES_ASSETS.goldResource :
                                          RESOURCES_ASSETS.meatResource
      );
      if (tex) {
        s.carry.texture = tex;
        s.carry.visible = true;
        s.carry.x = 0;
        s.carry.y = -50;
        s.carry.scale.set(0.55);
      }
      const abbrev = u.carrying.resource === "wood" ? "W" : u.carrying.resource === "gold" ? "G" : "F";
      s.carryLabel.text = `${abbrev}:${u.carrying.amount}`;
      s.carryLabel.visible = true;
      s.carryLabel.x = 0;
      s.carryLabel.y = -72;
    } else if (u.unitKind === "pawn" && u.workerRole && !depositHidden) {
      s.carry.visible = false;
      const label = u.workerRole === "miner" ? "Miner" : u.workerRole === "lumber" ? "Lumber" : "Builder";
      s.carryLabel.text = label;
      s.carryLabel.visible = true;
      s.carryLabel.x = 0;
      s.carryLabel.y = -62;
    } else {
      s.carry.visible = false;
      s.carryLabel.visible = false;
    }

    s.root.visible = !depositHidden;
    s.shadow.visible = !depositHidden;
  }

  private upsertBuilding(b: Building, _state: GameState) {
    let s = this.buildings.get(b.id);
    if (!s) {
      const root = new Container();
      const tex = pickBuildingTexture(this.cache, b);
      const body = new Sprite(tex);
      body.anchor.set(0.5, 1.0); // align bottom-center to building bottom
      const selection = new Graphics();
      const hpBg = new Graphics();
      const hpFg = new Graphics();
      const buildOverlay = new Graphics();
      root.addChild(selection);
      root.addChild(body);
      root.addChild(buildOverlay);
      root.addChild(hpBg);
      root.addChild(hpFg);
      this.entityLayer.addChild(root);
      s = { root, body, selection, hpBg, hpFg, buildOverlay, fire: null };
      this.buildings.set(b.id, s);
    }
    s.root.x = b.pos.x;
    s.root.y = b.pos.y + (b.height * TILE) / 2;
    s.root.zIndex = b.pos.y;
    s.body.alpha = b.built ? 1 : 0.55 + 0.4 * b.buildProgress;

    // selection
    s.selection.clear();
    if (this.selection.has(b.id)) {
      const w = b.width * TILE, h = b.height * TILE;
      s.selection
        .roundRect(-w / 2, -h, w, h, 6)
        .stroke({ width: 2, color: COLORS.parchment, alpha: 0.9 });
    }

    // HP bar above building
    s.hpBg.clear(); s.hpFg.clear();
    const showBar = b.hp < b.maxHp || !b.built || this.selection.has(b.id);
    if (showBar) {
      const w = b.width * TILE * 0.7;
      const h = 6;
      const yOff = -(b.height * TILE) - 14;
      s.hpBg.roundRect(-w / 2, yOff, w, h, 2).fill({ color: 0x000000, alpha: 0.6 });
      const ratio = Math.max(0, b.hp / b.maxHp);
      const col = b.built ? playerHpColor(b.owner) : 0xc8932b;
      s.hpFg.roundRect(-w / 2, yOff, w * ratio, h, 2).fill({ color: col, alpha: 0.95 });
    }

    // building progress shimmer
    s.buildOverlay.clear();
    if (!b.built) {
      const w = b.width * TILE, h = b.height * TILE;
      s.buildOverlay.rect(-w / 2, -h, w, h * (1 - b.buildProgress)).fill({ color: 0x000000, alpha: 0.35 });
    }
  }

  private upsertResource(r: ResourceNode) {
    let s = this.resources.get(r.id);
    if (!s) {
      const root = new Container();
      let body: Sprite;
      let anim: LoadedAnim | null = null;
      if (r.nodeKind === "tree") {
        const def = RESOURCES_ASSETS.trees[r.variant % RESOURCES_ASSETS.trees.length];
        anim = this.cache.anims.get(def.url) ?? null;
        body = new Sprite(anim?.textures[0]);
        body.anchor.set(0.5, 0.92);
      } else if (r.nodeKind === "gold") {
        const tex = this.cache.textures.get(RESOURCES_ASSETS.goldStones[r.variant % RESOURCES_ASSETS.goldStones.length])!;
        body = new Sprite(tex);
        body.anchor.set(0.5, 0.7);
      } else {
        // sheep
        anim = this.cache.anims.get(RESOURCES_ASSETS.sheep.idle.url) ?? null;
        body = new Sprite(anim?.textures[0]);
        body.anchor.set(0.5, 0.7);
      }
      root.addChild(body);
      this.entityLayer.addChild(root);
      let shadow: Sprite | null = null;
      if (r.nodeKind === "tree") {
        shadow = new Sprite(this.cache.textures.get("/assets/terrain/tileset/shadow.png")!);
        shadow.anchor.set(0.5);
        shadow.scale.set(0.55, 0.22);
        shadow.alpha = 0.4;
        this.shadowLayer.addChild(shadow);
      }
      s = { root, body, shadow, currentAnim: anim, variant: r.variant };
      this.resources.set(r.id, s);
    }

    s.root.x = r.pos.x; s.root.y = r.pos.y;
    s.root.zIndex = r.pos.y;
    if (s.shadow) { s.shadow.x = r.pos.x; s.shadow.y = r.pos.y + 6; }

    // animate trees rarely (wind sway)
    if (r.nodeKind === "tree" && s.currentAnim) {
      // tree sheets are 8 frames; only animate occasionally so it looks like wind
      const t = (r.id * 0.13 + performance.now() / 1000) * 0.6;
      const idx = Math.floor(t * s.currentAnim.fps) % s.currentAnim.textures.length;
      s.body.texture = s.currentAnim.textures[idx];
    } else if (r.nodeKind === "sheep" && s.currentAnim) {
      const idx = Math.floor((performance.now() / 1000) * s.currentAnim.fps + r.id) % s.currentAnim.textures.length;
      s.body.texture = s.currentAnim.textures[idx];
    }
  }

  private upsertProjectile(p: Projectile) {
    let s = this.projectiles.get(p.id);
    if (!s) {
      const tex = this.cache.textures.get("/assets/units/blue_units/archer/arrow.png")!;
      const sprite = new Sprite(tex);
      sprite.anchor.set(0.5, 0.5);
      this.projLayer.addChild(sprite);
      s = { root: sprite };
      this.projectiles.set(p.id, s);
    }
    s.root.x = p.pos.x; s.root.y = p.pos.y;
    s.root.rotation = Math.atan2(p.vel.y, p.vel.x);
  }

  private upsertEffect(e: Effect) {
    let s = this.effects.get(e.id);
    if (!s) {
      const animDef =
        e.effect === "explosion" ? FX.explosion2 :
        e.effect === "dust"      ? FX.dust1 :
        e.effect === "splash"    ? FX.splash :
        e.effect === "heal"      ? FX.dust2 :
                                    FX.fire1;
      const anim = this.cache.anims.get(animDef.url)!;
      const sp = new Sprite(anim.textures[0]);
      sp.anchor.set(0.5, 0.5);
      this.effectLayer.addChild(sp);
      s = { root: sp, anim, loop: false };
      this.effects.set(e.id, s);
    }
    const a = s.anim;
    const idx = Math.min(a.textures.length - 1, Math.floor((e.t / e.duration) * a.textures.length));
    s.root.texture = a.textures[idx];
    s.root.x = e.pos.x; s.root.y = e.pos.y;
    s.root.alpha = Math.max(0.1, 1 - e.t / e.duration);
  }
}

// ---------------- helpers --------------------------------------------------

function isPawnDepositHidden(u: Unit): boolean {
  if (u.unitKind !== "pawn" || u.task.kind !== "gather") return false;
  if (u.task.phase !== "depositing") return false;
  const t = u.task.depositT ?? 0;
  return t >= DEPOSIT.interactSec && t < DEPOSIT.interactSec + DEPOSIT.hiddenSec;
}

function pickUnitAnimKey(u: Unit): string {
  // We embed a stable string used as a cache key.
  // The string is also parsed (split by /) to get the state name.
  if (u.unitKind === "pawn") {
    const carryTag =
      u.carrying?.resource === "wood" ? "_wood" :
      u.carrying?.resource === "gold" ? "_gold" :
      u.carrying?.resource === "food" ? "_meat" : "";
    if (u.animState === "interact") {
      // pick interact tool by what they're doing
      if (u.task.kind === "build") return "pawn/interact_hammer";
      if (u.task.kind === "gather") {
        const phase = u.task.phase;
        if (phase === "harvest") {
          if (u.workerRole === "miner") return "pawn/interact_pickaxe";
          return "pawn/interact_axe";
        }
      }
      return "pawn/interact_axe";
    }
    if (u.animState === "run") return `pawn/run${carryTag}`;
    if (!u.carrying?.amount) {
      if (u.workerRole === "builder") return "pawn/idle_hammer";
      if (u.workerRole === "lumber") return "pawn/idle_axe";
      if (u.workerRole === "miner") return "pawn/idle_pickaxe";
    }
    return `pawn/idle${carryTag}`;
  }
  if (u.unitKind === "warrior") {
    if (u.animState === "attack") return "warrior/attack1";
    if (u.animState === "run") return "warrior/run";
    return "warrior/idle";
  }
  if (u.unitKind === "archer") {
    if (u.animState === "attack") return "archer/shoot";
    if (u.animState === "run") return "archer/run";
    return "archer/idle";
  }
  if (u.unitKind === "lancer") {
    if (u.animState === "attack") return "lancer/attack";
    if (u.animState === "run") return "lancer/run";
    return "lancer/idle";
  }
  if (u.unitKind === "monk") {
    if (u.animState === "heal") return "monk/heal";
    if (u.animState === "run") return "monk/run";
    return "monk/idle";
  }
  return "pawn/idle";
}

function playerColor(owner: number): "blue" | "red" | "yellow" | "purple" | "black" {
  // PlayerId 0 = blue (you), 1 = red (enemy). Future: derive from state.
  return owner === 0 ? "blue" : owner === 1 ? "red" : "yellow";
}

function playerHpColor(owner: number): number {
  return owner === 0 ? 0x4ade80 : 0xf87171;
}

/** Team-colored building sheet frame for a kind (used by buildings + placement ghost). */
export function textureForBuildingKind(cache: AssetCache, kind: BuildingKind, ownerId: number): Texture {
  const color = playerColor(ownerId);
  switch (kind) {
    case "castle":        return cache.buildings[color].castle;
    case "house":         return cache.buildings[color].house;
    case "builder_house": return cache.buildings[color].builder_house;
    case "farm":          return cache.buildings[color].farm;
    case "garden":        return cache.buildings[color].garden;
    case "barracks":      return cache.buildings[color].barracks;
    case "archery":       return cache.buildings[color].archery;
    case "monastery":     return cache.buildings[color].monastery;
    case "tower":         return cache.buildings[color].tower;
  }
  void BUILDING_STATS;
  return cache.buildings[color].house;
}

function pickBuildingTexture(cache: AssetCache, b: Building): Texture {
  return textureForBuildingKind(cache, b.buildingKind, b.owner);
}
