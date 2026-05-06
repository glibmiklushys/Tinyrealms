// DOM-based HUD overlay sitting on top of the PixiJS canvas. Reading is
// one-way (HUD reads state and selection each frame); writing is via the
// command queue.

import type { BuildingKind, UnitKind } from "../config";
import {
  BUILDING_MAX_LEVEL,
  BUILDING_LEVEL_UPGRADE,
  BUILDING_STATS,
  UNIT_STATS,
  buildingPassiveFoodPerSec,
  buildingPassiveIncomeFactor,
  buildingTowerDamageFactor,
} from "../config";
import type { Command } from "../sim/commands";
import type { GameState, EntityId, Player, WorkerRole } from "../sim/state";
import { isBuilding, isUnit } from "../sim/state";

export interface HUDEnv {
  myPlayerId: number;
  enqueue: (cmd: Command) => void;
  setBuildMode: (b: { building: BuildingKind } | null) => void;
  state: () => GameState;
  selection: () => Set<EntityId>;
  /** Live build mode (for banner + tile hint). */
  buildMode?: () => { building: BuildingKind } | null;
  hoverTile?: () => { x: number; y: number };
}

const ICON_BUILD: Record<BuildingKind, string> = {
  castle: "/assets/ui_elements/ui_elements/icons/icon_01.png",
  house: "/assets/ui_elements/ui_elements/icons/icon_07.png",
  builder_house: "/assets/ui_elements/ui_elements/icons/icon_03.png",
  farm: "/assets/terrain/resources/meat/meat_resource/meat_resource.png",
  garden: "/assets/terrain/decorations/bushes/bushe1.png",
  barracks: "/assets/ui_elements/ui_elements/icons/icon_03.png",
  archery: "/assets/ui_elements/ui_elements/icons/icon_04.png",
  monastery: "/assets/ui_elements/ui_elements/icons/icon_06.png",
  tower: "/assets/ui_elements/ui_elements/icons/icon_05.png",
};

const ICON_UNIT: Record<UnitKind, string> = {
  pawn: "/assets/ui_elements/ui_elements/icons/icon_07.png",
  warrior: "/assets/ui_elements/ui_elements/icons/icon_08.png",
  archer: "/assets/ui_elements/ui_elements/icons/icon_09.png",
  lancer: "/assets/ui_elements/ui_elements/icons/icon_10.png",
  monk: "/assets/ui_elements/ui_elements/icons/icon_11.png",
};

const RES_ICON = {
  wood: "/assets/terrain/resources/wood/wood_resource/wood_resource.png",
  gold: "/assets/terrain/resources/gold/gold_resource/gold_resource.png",
  food: "/assets/terrain/resources/meat/meat_resource/meat_resource.png",
};

const BUILD_ORDER: BuildingKind[] = [
  "house", "builder_house", "farm", "garden", "barracks", "archery", "monastery", "tower",
];
const BUILD_HOTKEY: Partial<Record<BuildingKind, string>> = {
  house: "H", builder_house: "P", farm: "F", garden: "D", barracks: "B", archery: "R", tower: "T", monastery: "M",
};
const BUILD_TITLE: Partial<Record<BuildingKind, string>> = {
  house: "House (+pop)",
  builder_house: "Builder hall",
  farm: "Farm",
  garden: "Garden",
  barracks: "Barracks",
  archery: "Archery",
  monastery: "Monastery",
  tower: "Tower",
};

let stylesInjected = false;
function injectHudStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const s = document.createElement("style");
  s.textContent = `
    /* Roblox / polished-2D builder vibe: chunky frames, high contrast, playful type */
    .tr-hud-panel {
      border-radius: 16px;
      border: 3px solid #1a120c;
      background: linear-gradient(180deg, #3d2e22 0%, #2a1f16 55%, #231a12 100%);
      box-shadow:
        inset 0 2px 0 rgba(255,255,255,.08),
        0 4px 0 rgba(0,0,0,.45),
        0 12px 28px rgba(0,0,0,.4);
    }
    .tr-hud-h2 {
      font-size: 12px; letter-spacing: .14em; text-transform: uppercase;
      color: #fde68a; margin: 0 0 10px 0; font-weight: 800;
      text-shadow: 0 2px 0 rgba(0,0,0,.55);
    }
    .tr-res-block {
      display: flex; align-items: center; gap: 12px;
      padding: 10px 12px; border-radius: 12px;
      background: rgba(0,0,0,.32);
      border: 2px solid rgba(0,0,0,.35);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.06);
    }
    .tr-res-block img {
      width: 32px; height: 32px; image-rendering: pixelated;
      flex-shrink: 0;
      filter: drop-shadow(0 2px 0 rgba(0,0,0,.5));
    }
    .tr-res-block__label {
      font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase;
      color: #a89878; text-shadow: 0 1px 0 rgba(0,0,0,.5);
    }
    .tr-res-block__val {
      font-size: 22px; font-weight: 800; line-height: 1.1;
      font-variant-numeric: tabular-nums;
      color: #fffbeb;
      text-shadow:
        0 1px 0 #0f0a06,
        0 2px 0 rgba(0,0,0,.55),
        0 0 12px rgba(253,224,71,.15);
    }
    .tr-res-block__sub {
      font-size: 12px; font-weight: 600; color: #d4c4a4; margin-top: 2px;
    }
    .tr-top-strip {
      border-bottom: 3px solid #1a120c;
      box-shadow: 0 6px 0 rgba(0,0,0,.2);
    }
    .tr-activity-wrap {
      flex: 1; min-height: 36px;
      display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
    }
    .tr-activity-pill {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 6px 12px; border-radius: 999px;
      font-size: 13px; font-weight: 700;
      border: 2px solid #1a120c;
      box-shadow: 0 3px 0 rgba(0,0,0,.35), inset 0 1px 0 rgba(255,255,255,.12);
    }
    .tr-activity-pill--build {
      background: linear-gradient(180deg, #38bdf8 0%, #0284c7 100%);
      color: #f0f9ff;
      text-shadow: 0 1px 0 rgba(0,0,0,.35);
    }
    .tr-activity-pill--train {
      background: linear-gradient(180deg, #fbbf24 0%, #d97706 100%);
      color: #1c1208;
      text-shadow: 0 1px 0 rgba(255,255,255,.25);
    }
    .tr-activity-pill--upgrade {
      background: linear-gradient(180deg, #c084fc 0%, #7c3aed 100%);
      color: #faf5ff;
      text-shadow: 0 1px 0 rgba(0,0,0,.35);
    }
    .tr-activity-pill__tag {
      font-size: 10px; font-weight: 800; letter-spacing: .12em; opacity: .9;
    }
    .tr-activity-empty {
      font-size: 13px; font-weight: 600; color: rgba(245,233,200,.45);
      padding: 4px 0;
    }
    .tr-badge {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 6px 14px; border-radius: 999px;
      font-size: 14px; font-weight: 800;
      background: linear-gradient(180deg, #44403c 0%, #292524 100%);
      border: 2px solid #1a120c;
      color: #fef3c7;
      box-shadow: 0 3px 0 rgba(0,0,0,.35), inset 0 1px 0 rgba(255,255,255,.1);
      text-shadow: 0 1px 0 rgba(0,0,0,.5);
    }
    .tr-build-card {
      display: flex; align-items: center; gap: 12px;
      min-height: 72px;
      padding: 12px 14px; border-radius: 14px; border: 3px solid #1a120c;
      background: linear-gradient(180deg, rgba(55,42,30,.95) 0%, rgba(28,20,14,.92) 100%);
      cursor: pointer; pointer-events: auto; position: relative; z-index: 1;
      text-align: left;
      color: #fffbeb;
      transition: transform .12s ease, border-color .15s, filter .15s;
      width: 100%; box-sizing: border-box;
      box-shadow: 0 4px 0 rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.08);
    }
    .tr-build-card:hover:not(:disabled) {
      border-color: #fbbf24;
      filter: brightness(1.06);
      transform: translateY(-1px);
    }
    .tr-build-card:active:not(:disabled) { transform: translateY(2px); box-shadow: 0 2px 0 rgba(0,0,0,.4); }
    .tr-build-card:disabled { opacity: .42; cursor: not-allowed; filter: grayscale(.35); }
    .tr-kbd {
      min-width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center;
      border-radius: 8px; font-size: 12px; font-weight: 800;
      background: #0c0a08; border: 2px solid #292524; color: #fde68a;
      box-shadow: 0 2px 0 rgba(0,0,0,.5);
    }
    .tr-train-card {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 14px; border-radius: 14px; border: 3px solid #1a120c;
      background: linear-gradient(180deg, rgba(55,42,30,.95) 0%, rgba(28,20,14,.92) 100%);
      cursor: pointer; color: #fffbeb;
      transition: transform .1s, border-color .15s;
      box-shadow: 0 3px 0 rgba(0,0,0,.38);
    }
    .tr-train-card:hover:not(:disabled) { border-color: #fbbf24; transform: translateY(-1px); }
    .tr-train-card:disabled { opacity: .42; cursor: not-allowed; }
    .tr-queue-slot {
      width: 52px; height: 52px; border-radius: 12px; position: relative; overflow: hidden;
      cursor: pointer; border: 3px solid #1a120c; background: rgba(0,0,0,.5);
      box-shadow: 0 3px 0 rgba(0,0,0,.35);
    }
    .tr-queue-slot:hover { border-color: #fbbf24; }
    .tr-res-row { display: flex; align-items: center; gap: 4px; font-size: 11px; color: #e8dcc4; }
    .tr-res-row img { width: 14px; height: 14px; image-rendering: pixelated; }
    .tr-hp-bar {
      height: 14px; border-radius: 8px;
      background: rgba(0,0,0,.55);
      border: 2px solid #1a120c;
      overflow: hidden;
      box-shadow: inset 0 2px 4px rgba(0,0,0,.45);
    }
    .tr-hp-bar__fill {
      height: 100%;
      background: linear-gradient(180deg, #4ade80 0%, #16a34a 100%);
      border-radius: 6px;
      box-shadow: inset 0 1px 0 rgba(255,255,255,.35);
    }
    .tr-build-hammer-row {
      display: flex; align-items: center; gap: 12px;
      padding: 10px 12px; border-radius: 12px;
      background: rgba(0,0,0,.32);
      border: 2px solid rgba(0,0,0,.35);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.06);
      pointer-events: auto;
    }
    .tr-build-hammer-btn {
      flex-shrink: 0;
      width: 56px; height: 56px;
      padding: 0; border: none; border-radius: 10px;
      cursor: pointer;
      overflow: hidden;
      background: #1a1510;
      border: 2px solid rgba(0,0,0,.45);
      box-shadow: 0 2px 0 rgba(0,0,0,.35);
      transition: transform .1s ease, filter .1s ease;
    }
    .tr-build-hammer-btn:hover { filter: brightness(1.12); transform: scale(1.03); }
    .tr-build-hammer-btn:active { transform: scale(0.97); }
    .tr-build-hammer-btn--open {
      outline: 3px solid #38bdf8;
      outline-offset: 2px;
    }
    .tr-build-hammer-tex {
      width: 100%; height: 100%;
      image-rendering: pixelated;
      background-image: url("/assets/units/blue_units/pawn/pawn_interact_hammer.png");
      background-size: 576px 192px;
      background-position: 0 0;
      background-repeat: no-repeat;
    }
    .tr-build-close {
      width: 36px; height: 36px; border-radius: 10px;
      border: 2px solid #1a120c;
      background: rgba(0,0,0,.35);
      color: #fde68a; font-size: 22px; font-weight: 800; line-height: 1;
      cursor: pointer; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 2px 0 rgba(0,0,0,.35);
    }
    .tr-build-close:hover { background: rgba(220,38,38,.35); color: #fff; }
  `;
  document.head.appendChild(s);
}

export class HUD {
  root: HTMLDivElement;
  leftRail: HTMLDivElement;
  topBar: HTMLDivElement;
  bottomPanel: HTMLDivElement;
  selectionPanel: HTMLDivElement;
  buildPanelWrap: HTMLDivElement;
  buildPanel: HTMLDivElement;
  banner: HTMLDivElement;
  endScreen: HTMLDivElement;
  toast: HTMLDivElement;
  toastTimer: number | null = null;

  private woodVal: HTMLDivElement;
  private goldVal: HTMLDivElement;
  private foodVal: HTMLDivElement;
  private popLine: HTMLDivElement;
  private timeVal: HTMLDivElement;
  private scoreVal: HTMLDivElement | null = null;
  private activityRow: HTMLDivElement;
  private buildSub: HTMLDivElement;
  private buildersInfo: HTMLDivElement;
  private buildMenuBackdrop: HTMLDivElement;
  private buildMenuCard: HTMLDivElement;
  private hammerBtn: HTMLButtonElement;
  private buildMenuOpen = false;
  /** When true, blueprint buttons are rebuilt; avoid clearing them every frame (breaks clicks). */
  private blueprintGridDirty = true;

  constructor(private env: HUDEnv) {
    injectHudStyles();

    this.root = document.createElement("div");
    Object.assign(this.root.style, {
      position: "fixed", inset: "0", pointerEvents: "none", zIndex: "10",
      fontFamily: "'Fredoka', 'Segoe UI', system-ui, sans-serif",
      color: "#f5e9c8",
    } as CSSStyleDeclaration);
    document.body.appendChild(this.root);

    this.leftRail = document.createElement("div");
    Object.assign(this.leftRail.style, {
      position: "absolute", left: "16px", top: "50%", transform: "translateY(-50%)",
      padding: "16px 14px", minWidth: "200px", maxWidth: "240px", pointerEvents: "auto", zIndex: "11",
      display: "flex", flexDirection: "column", gap: "10px",
    });
    this.leftRail.classList.add("tr-hud-panel");
    this.root.appendChild(this.leftRail);

    const mkRes = (icon: string, label: string, withSub: boolean) => {
      const block = document.createElement("div");
      block.className = "tr-res-block";
      const im = document.createElement("img");
      im.src = icon;
      im.alt = "";
      const col = document.createElement("div");
      const lab = document.createElement("div");
      lab.className = "tr-res-block__label";
      lab.textContent = label;
      const val = document.createElement("div");
      val.className = "tr-res-block__val";
      val.textContent = "0";
      col.appendChild(lab);
      col.appendChild(val);
      let sub: HTMLDivElement | null = null;
      if (withSub) {
        sub = document.createElement("div");
        sub.className = "tr-res-block__sub";
        col.appendChild(sub);
      }
      block.appendChild(im);
      block.appendChild(col);
      this.leftRail.appendChild(block);
      return { val, sub };
    };
    const w = mkRes(RES_ICON.wood, "Wood", false);
    this.woodVal = w.val;
    const g = mkRes(RES_ICON.gold, "Gold", false);
    this.goldVal = g.val;
    const f = mkRes(RES_ICON.food, "Food", true);
    this.foodVal = f.val;
    this.popLine = f.sub!;

    const hammerRow = document.createElement("div");
    hammerRow.className = "tr-build-hammer-row";
    this.hammerBtn = document.createElement("button");
    this.hammerBtn.type = "button";
    this.hammerBtn.className = "tr-build-hammer-btn";
    this.hammerBtn.title = "Open build menu · C to toggle";
    this.hammerBtn.setAttribute("aria-label", "Open build menu");
    const hammerTex = document.createElement("div");
    hammerTex.className = "tr-build-hammer-tex";
    this.hammerBtn.appendChild(hammerTex);
    this.hammerBtn.onclick = e => {
      e.stopPropagation();
      this.toggleBuildMenu();
    };
    const hammerMeta = document.createElement("div");
    const hammerLab = document.createElement("div");
    hammerLab.className = "tr-res-block__label";
    hammerLab.textContent = "Construct";
    const hammerSub = document.createElement("div");
    hammerSub.className = "tr-res-block__val";
    hammerSub.style.fontSize = "15px";
    hammerSub.textContent = "Build menu";
    hammerMeta.appendChild(hammerLab);
    hammerMeta.appendChild(hammerSub);
    hammerRow.appendChild(this.hammerBtn);
    hammerRow.appendChild(hammerMeta);
    this.leftRail.appendChild(hammerRow);

    this.topBar = el("div", {
      position: "absolute", top: "0", left: "0", right: "0", minHeight: "56px",
      display: "flex", alignItems: "center", gap: "14px", padding: "10px 20px 12px",
      paddingLeft: "260px",
      background: "linear-gradient(180deg, #2a1f16 0%, rgba(42,31,22,.92) 70%, rgba(42,31,22,0))",
      pointerEvents: "auto",
    });
    this.topBar.classList.add("tr-top-strip");
    this.root.appendChild(this.topBar);

    this.activityRow = document.createElement("div");
    this.activityRow.className = "tr-activity-wrap";
    this.topBar.appendChild(this.activityRow);

    this.timeVal = document.createElement("div");
    this.timeVal.className = "tr-badge";
    this.topBar.appendChild(this.timeVal);

    this.bottomPanel = el("div", {
      position: "absolute", bottom: "0", left: "0", right: "0",
      display: "flex", padding: "14px 18px 20px", gap: "16px", alignItems: "stretch",
      background: "linear-gradient(0deg, #1a1410 0%, rgba(26,20,16,.94) 55%, rgba(26,20,16,0))",
      borderTop: "3px solid #1a120c", pointerEvents: "auto",
    });
    this.root.appendChild(this.bottomPanel);

    this.selectionPanel = document.createElement("div");
    Object.assign(this.selectionPanel.style, {
      flex: "1", minWidth: "0", display: "flex", flexDirection: "column", padding: "12px 16px",
    });
    this.selectionPanel.classList.add("tr-hud-panel");
    this.bottomPanel.appendChild(this.selectionPanel);

    this.buildMenuBackdrop = el("div", {
      position: "fixed", inset: "0", zIndex: "15", display: "none",
      background: "rgba(10,8,6,.42)", pointerEvents: "auto",
    });
    this.buildMenuBackdrop.onclick = () => this.closeBuildMenu();
    this.root.appendChild(this.buildMenuBackdrop);

    this.buildMenuCard = document.createElement("div");
    Object.assign(this.buildMenuCard.style, {
      position: "fixed",
      left: "50%",
      top: "50%",
      transform: "translate(-50%, -50%)",
      zIndex: "16",
      display: "none",
      flexDirection: "column",
      pointerEvents: "auto",
      width: "min(480px, calc(100vw - 48px))",
      maxHeight: "min(78vh, 620px)",
      padding: "14px 14px 12px",
    });
    this.buildMenuCard.classList.add("tr-hud-panel");
    this.buildMenuCard.onclick = e => e.stopPropagation();
    this.buildMenuCard.onmousedown = e => e.stopPropagation();
    this.root.appendChild(this.buildMenuCard);

    this.buildPanelWrap = document.createElement("div");
    Object.assign(this.buildPanelWrap.style, {
      display: "flex", flexDirection: "column", flex: "1", minHeight: "0", gap: "8px",
    });

    const buildHeadRow = el("div", {
      display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexShrink: "0",
    });
    const buildHead = document.createElement("h2");
    buildHead.className = "tr-hud-h2";
    buildHead.style.margin = "0";
    buildHead.textContent = "Build";
    const buildClose = document.createElement("button");
    buildClose.type = "button";
    buildClose.className = "tr-build-close";
    buildClose.title = "Close";
    buildClose.setAttribute("aria-label", "Close build menu");
    buildClose.textContent = "×";
    buildClose.onclick = () => this.closeBuildMenu();
    buildHeadRow.appendChild(buildHead);
    buildHeadRow.appendChild(buildClose);
    this.buildPanelWrap.appendChild(buildHeadRow);

    this.buildersInfo = el("div", {
      fontSize: "12px", color: "#f5cf5a", minHeight: "20px", lineHeight: "1.45", fontWeight: "600",
    });
    this.buildPanelWrap.appendChild(this.buildersInfo);

    this.buildSub = el("div", {
      fontSize: "12px", color: "#a89878", marginBottom: "10px", lineHeight: "1.45",
    });
    this.buildPanelWrap.appendChild(this.buildSub);

    this.buildPanel = el("div", {
      display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px",
      overflowY: "auto", flex: "1", minHeight: "0", paddingRight: "4px",
    });
    this.buildPanelWrap.appendChild(this.buildPanel);
    this.buildMenuCard.appendChild(this.buildPanelWrap);

    this.banner = el("div", {
      position: "absolute", top: "72px", left: "50%", transform: "translateX(-50%)",
      padding: "12px 28px", borderRadius: "999px",
      background: "linear-gradient(180deg, #422006 0%, #271a0d 100%)",
      border: "3px solid #1a120c", fontSize: "15px", fontWeight: "700", pointerEvents: "none",
      boxShadow: "0 4px 0 rgba(0,0,0,.45), 0 12px 28px rgba(0,0,0,.45)",
      color: "#fffbeb",
    });
    this.banner.style.display = "none";
    this.root.appendChild(this.banner);

    this.endScreen = el("div", {
      position: "absolute", inset: "0", display: "none",
      alignItems: "center", justifyContent: "center", flexDirection: "column", gap: "20px",
      background: "rgba(0,0,0,.65)", pointerEvents: "auto", zIndex: "20",
    });
    this.root.appendChild(this.endScreen);

    this.toast = el("div", {
      position: "absolute", bottom: "220px", left: "50%", transform: "translateX(-50%)",
      padding: "12px 24px", borderRadius: "999px",
      background: "linear-gradient(180deg, #1e3a5f 0%, #0f172a 100%)",
      border: "3px solid #1a120c",
      pointerEvents: "none", opacity: "0", transition: "opacity .2s ease",
      fontSize: "14px", fontWeight: "700", maxWidth: "440px", textAlign: "center",
      boxShadow: "0 4px 0 rgba(0,0,0,.4)",
    });
    this.root.appendChild(this.toast);
  }

  showToast(msg: string) {
    this.toast.textContent = msg;
    this.toast.style.opacity = "1";
    if (this.toastTimer != null) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => { this.toast.style.opacity = "0"; }, 2200);
  }

  setBuildModeIndicator(_b: { building: BuildingKind } | null) {
    if (_b) this.buildMenuOpen = false;
    this.refreshBuildBanner();
    this.syncBuildMenu();
  }

  closeBuildMenu() {
    this.buildMenuOpen = false;
    this.syncBuildMenu();
  }

  toggleBuildMenu() {
    this.buildMenuOpen = !this.buildMenuOpen;
    this.syncBuildMenu();
  }

  /**
   * The selection panel is rebuilt every `hud.update()` (clears `innerHTML`).
   * A normal `click` can be lost if the node is removed between mousedown and mouseup.
   * `pointerdown` runs synchronously in the same event turn, before the next rAF rebuild.
   */
  private onPrimaryPointerActivate(ev: PointerEvent, fn: () => void) {
    if (ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    fn();
  }

  private selectionHasPawn(): boolean {
    const s = this.env.state();
    for (const id of this.env.selection()) {
      const e = s.entities.get(id);
      if (isUnit(e) && e.unitKind === "pawn" && e.owner === this.env.myPlayerId) return true;
    }
    return false;
  }

  private syncBuildMenu() {
    const open = this.buildMenuOpen;
    this.buildMenuBackdrop.style.display = open ? "block" : "none";
    this.buildMenuCard.style.display = open ? "flex" : "none";
    this.hammerBtn.classList.toggle("tr-build-hammer-btn--open", open);
  }

  private anyOwnPawn(): boolean {
    const s = this.env.state();
    for (const e of s.entities.values()) {
      if (isUnit(e) && e.unitKind === "pawn" && e.owner === this.env.myPlayerId) return true;
    }
    return false;
  }

  private refreshBuildBanner() {
    const bm = this.env.buildMode?.() ?? null;
    if (!bm) {
      this.banner.style.display = "none";
      return;
    }
    this.banner.style.display = "";
    const name = BUILD_TITLE[bm.building] ?? labelize(bm.building);
    const ht = this.env.hoverTile?.();
    const grid = ht ? ` · <span style="opacity:.85">grid (${ht.x}, ${ht.y})</span>` : "";
    this.banner.innerHTML = `<b style="color:#f5cf5a">${name}</b>${grid} · <span style="opacity:.85">Left-click place</span> · <span style="opacity:.65">Shift keeps mode · Esc</span>`;
  }

  showEndScreen(won: boolean, onRestart: () => void) {
    this.endScreen.style.display = "flex";
    this.endScreen.innerHTML = "";
    const title = el("div", { fontSize: "72px", color: won ? "#f5cf5a" : "#f5a89c", textShadow: "0 4px 0 #2a1a0a" });
    title.textContent = won ? "VICTORY" : "DEFEAT";
    const sub = el("div", { fontSize: "18px", color: "#c2a76a" });
    sub.textContent = won ? "the realm is yours" : "the kingdom has fallen";
    const btn = el("button", {
      marginTop: "24px", padding: "16px 40px",
      fontFamily: "inherit", fontWeight: "800",
      background: "linear-gradient(180deg, #4ade80 0%, #16a34a 100%)",
      color: "#052e16", border: "3px solid #1a120c", fontSize: "20px",
      borderRadius: "14px", cursor: "pointer", letterSpacing: ".04em",
      boxShadow: "0 4px 0 rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.35)",
    });
    btn.textContent = "Play Again";
    btn.onclick = () => { this.endScreen.style.display = "none"; onRestart(); };
    this.endScreen.appendChild(title);
    this.endScreen.appendChild(sub);
    this.endScreen.appendChild(btn);
  }

  update() {
    const s = this.env.state();
    const me = s.players[this.env.myPlayerId];
    const enemy = s.players.find(p => p.team !== me.team);

    this.woodVal.textContent = String(me.resources.wood);
    this.goldVal.textContent = String(me.resources.gold);
    this.foodVal.textContent = String(me.resources.food);
    this.popLine.textContent = `Pop ${me.population} / ${me.populationCap}`;
    this.timeVal.textContent = `TIME ${formatTime(s.time)}`;

    this.renderActivityRow(s, me);
    this.refreshBuildBanner();

    if (enemy) {
      if (!this.scoreVal) {
        this.scoreVal = document.createElement("div");
        this.scoreVal.className = "tr-badge";
        this.scoreVal.style.marginLeft = "4px";
        this.topBar.appendChild(this.scoreVal);
      }
      const myCount = countOwned(s, me.id), enemyCount = countOwned(s, enemy.id);
      this.scoreVal.innerHTML = `<span style="color:#7cc8ff">You ${myCount}</span> &nbsp;vs&nbsp; <span style="color:#ff8e8e">Foe ${enemyCount}</span>`;
    }

    this.renderSelectionPanel();
    this.renderBuildPanel();
    this.syncBuildMenu();
  }

  private renderActivityRow(s: GameState, me: Player) {
    this.activityRow.innerHTML = "";
    const pills: HTMLDivElement[] = [];
    for (const e of s.entities.values()) {
      if (!isBuilding(e) || e.owner !== me.id) continue;
      if (!e.built) {
        const title = BUILD_TITLE[e.buildingKind] ?? labelize(e.buildingKind);
        const left = (1 - e.buildProgress) * BUILDING_STATS[e.buildingKind].buildTime;
        const pill = document.createElement("div");
        pill.className = "tr-activity-pill tr-activity-pill--build";
        pill.innerHTML = `<span class="tr-activity-pill__tag">BUILD</span><span>${title} · ${Math.round(e.buildProgress * 100)}% · ${left.toFixed(1)}s</span>`;
        pills.push(pill);
      }
      if (e.built && e.upgradeProgress != null) {
        const up = BUILDING_LEVEL_UPGRADE[e.level - 1];
        const title = BUILD_TITLE[e.buildingKind] ?? labelize(e.buildingKind);
        const left = (1 - e.upgradeProgress) * (up?.time ?? 0);
        const pill = document.createElement("div");
        pill.className = "tr-activity-pill tr-activity-pill--upgrade";
        pill.innerHTML = `<span class="tr-activity-pill__tag">UPGRADE</span><span>${title} · L${e.level}→${e.level + 1} · ${Math.round(e.upgradeProgress * 100)}% · ${left.toFixed(1)}s</span>`;
        pills.push(pill);
      }
      if (e.built && e.trainQueue.length > 0) {
        const q = e.trainQueue[0];
        const pill = document.createElement("div");
        pill.className = "tr-activity-pill tr-activity-pill--train";
        pill.innerHTML = `<span class="tr-activity-pill__tag">TRAIN</span><span>${labelize(q.unit)} · ${q.remaining.toFixed(1)}s</span>`;
        pills.push(pill);
      }
    }
    if (!pills.length) {
      const empty = document.createElement("div");
      empty.className = "tr-activity-empty";
      empty.textContent = "No construction, upgrades, or training right now";
      this.activityRow.appendChild(empty);
      return;
    }
    for (const p of pills) this.activityRow.appendChild(p);
  }

  private renderSelectionPanel() {
    this.selectionPanel.innerHTML = "";
    const head = document.createElement("h2");
    head.className = "tr-hud-h2";
    head.textContent = "Selected";
    this.selectionPanel.appendChild(head);

    const s = this.env.state();
    const me = s.players[this.env.myPlayerId];
    const sel = this.env.selection();
    if (sel.size === 0) {
      const hint = el("div", { color: "#d4c4a4", fontSize: "13px", lineHeight: "1.75" });
      hint.innerHTML = `<b style="color:#f5cf5a">Controls</b><br>
      <b>Left-click</b> or drag a box to select · <b>Right-click</b> move / gather / attack / build / heal<br>
      <b>Space</b> jump to your castle · <b>Esc</b> clear selection / cancel build<br>
      <b>Construct</b> (hammer, left panel) or <span class="tr-kbd" style="margin:0 2px">C</span> opens <b>blueprints</b>. Hotkeys: <span class="tr-kbd" style="margin:0 2px">H</span><span class="tr-kbd" style="margin:0 2px">P</span><span class="tr-kbd" style="margin:0 2px">F</span><span class="tr-kbd" style="margin:0 2px">D</span><span class="tr-kbd" style="margin:0 2px">B</span><span class="tr-kbd" style="margin:0 2px">R</span><span class="tr-kbd" style="margin:0 2px">T</span><span class="tr-kbd" style="margin:0 2px">M</span><br>
      You start with a <b>Miner</b>, <b>Lumberjack</b>, and <b>Builder</b>. Select a production building to <b>train</b> · rally: right-click ground with only a building selected`;
      this.selectionPanel.appendChild(hint);
      return;
    }

    const units = new Map<string, number>();
    let representative: { kind: string; hp: number; max: number } | null = null;
    let selBuilding: { id: EntityId; kind: BuildingKind } | null = null;
    for (const id of sel) {
      const e = s.entities.get(id);
      if (isUnit(e)) {
        units.set(e.unitKind, (units.get(e.unitKind) ?? 0) + 1);
        if (!representative) representative = { kind: e.unitKind, hp: e.hp, max: e.maxHp };
      } else if (isBuilding(e)) {
        selBuilding = { id: e.id, kind: e.buildingKind };
      }
    }

    if (selBuilding) {
      const e = s.entities.get(selBuilding.id);
      if (isBuilding(e)) {
        const row = el("div", { display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" });
        const img = document.createElement("img");
        img.src = ICON_BUILD[selBuilding.kind];
        img.style.width = "48px"; img.style.height = "48px"; img.style.imageRendering = "pixelated";
        const col = el("div", { flex: "1" });
        const title = el("div", { fontSize: "20px", fontWeight: "800", letterSpacing: ".02em" });
        title.textContent = BUILD_TITLE[selBuilding.kind] ?? labelize(selBuilding.kind);
        const stats = el("div", { fontSize: "13px", color: "#c2a76a", marginTop: "2px" });
        const passiveBase = buildingPassiveFoodPerSec(selBuilding.kind);
        const passive = passiveBase * buildingPassiveIncomeFactor(e.level);
        const foodExtra = passiveBase > 0 ? ` · +${passive.toFixed(2)} food/s` : "";
        const towerDmg =
          selBuilding.kind === "tower"
            ? Math.max(1, Math.round((BUILDING_STATS.tower as { attackDamage: number }).attackDamage * buildingTowerDamageFactor(e.level)))
            : 0;
        const towerExtra = towerDmg > 0 ? ` · ${towerDmg} dmg / shot` : "";
        const status = e.built ? "Ready" : `Building ${Math.round(e.buildProgress * 100)}%`;
        stats.textContent = `Level ${e.level}/${BUILDING_MAX_LEVEL} · ${status} · HP ${Math.round(e.hp)}/${e.maxHp}${foodExtra}${towerExtra}`;
        col.appendChild(title); col.appendChild(stats);
        row.appendChild(img); row.appendChild(col);
        this.selectionPanel.appendChild(row);

        if (e.built) {
          if (e.owner === me.id) {
            if (e.upgradeProgress != null) {
              const up = BUILDING_LEVEL_UPGRADE[e.level - 1];
              const upHead = document.createElement("h2");
              upHead.className = "tr-hud-h2";
              upHead.textContent = `Upgrading to level ${e.level + 1}`;
              upHead.style.marginTop = "10px";
              this.selectionPanel.appendChild(upHead);
              const barWrap = el("div", { position: "relative", height: "16px", borderRadius: "8px", overflow: "hidden", border: "2px solid #1a120c", background: "rgba(0,0,0,.45)", marginTop: "4px" });
              const fill = el("div", {
                position: "absolute", left: "0", top: "0", bottom: "0",
                width: `${e.upgradeProgress * 100}%`,
                background: "linear-gradient(90deg, #a78bfa, #7c3aed)",
                transition: "width .08s linear",
              });
              barWrap.appendChild(fill);
              this.selectionPanel.appendChild(barWrap);
              const sub = el("div", { fontSize: "12px", color: "#a89878", marginTop: "6px" });
              const left = (1 - e.upgradeProgress) * (up?.time ?? 0);
              sub.textContent = `${Math.round(e.upgradeProgress * 100)}% · ${left.toFixed(1)}s remaining`;
              this.selectionPanel.appendChild(sub);
            } else if (e.level < BUILDING_MAX_LEVEL) {
              const up = BUILDING_LEVEL_UPGRADE[e.level - 1];
              if (up) {
                const upHead = document.createElement("h2");
                upHead.className = "tr-hud-h2";
                upHead.textContent = "Upgrade structure";
                upHead.style.marginTop = "10px";
                this.selectionPanel.appendChild(upHead);
                const afford =
                  me.resources.wood >= (up.wood ?? 0) &&
                  me.resources.gold >= (up.gold ?? 0);
                const ub = document.createElement("button");
                ub.type = "button";
                ub.className = "tr-train-card";
                ub.style.width = "100%";
                ub.style.boxSizing = "border-box";
                ub.disabled = !afford;
                ub.title = afford ? `Upgrade to level ${e.level + 1}` : "Not enough resources";
                ub.innerHTML = `<div style="flex:1;text-align:left"><b>Level ${e.level} → ${e.level + 1}</b> · ${up.time}s<br>
                  <span class="tr-res-row"><img src="${RES_ICON.wood}" alt=""/>${up.wood ?? 0}</span>
                  <span class="tr-res-row"><img src="${RES_ICON.gold}" alt=""/>${up.gold ?? 0}</span>
                  </div>`;
                ub.addEventListener("pointerdown", ev => {
                  this.onPrimaryPointerActivate(ev, () => {
                    if (!afford) {
                      this.showToast("Not enough resources");
                      return;
                    }
                    this.env.enqueue({ kind: "upgradeBuilding", player: this.env.myPlayerId, buildingId: selBuilding!.id });
                  });
                });
                this.selectionPanel.appendChild(ub);
              }
            }
          }
          const trains = (BUILDING_STATS[e.buildingKind].trains as readonly UnitKind[]);
          if (trains.length) {
            const sub = document.createElement("h2");
            sub.className = "tr-hud-h2";
            sub.textContent = "Train";
            sub.style.marginTop = "10px";
            this.selectionPanel.appendChild(sub);

            const trainRow = el("div", { display: "flex", flexWrap: "wrap", gap: "8px" });
            trains.forEach(u => {
              const cost = UNIT_STATS[u].cost;
              const popCost = u === "lancer" ? 2 : 1;
              const afford =
                me.resources.wood >= (cost.wood ?? 0) &&
                me.resources.gold >= (cost.gold ?? 0) &&
                me.resources.food >= (cost.food ?? 0) &&
                me.population + popCost <= me.populationCap;
              const b = document.createElement("button");
              b.type = "button";
              b.className = "tr-train-card";
              b.disabled = !afford;
              b.title = afford ? `Train ${labelize(u)}` : "Not enough resources or population cap";
              const iu = document.createElement("img");
              iu.src = ICON_UNIT[u]; iu.style.width = "36px"; iu.style.height = "36px"; iu.style.imageRendering = "pixelated";
              const txt = el("div", { fontSize: "12px" });
              const foodLine = (cost.food ?? 0) > 0 ? `<span class="tr-res-row"><img src="${RES_ICON.food}" alt=""/>${cost.food}</span>` : "";
              txt.innerHTML = `<b>${labelize(u)}</b><br>
                <span class="tr-res-row"><img src="${RES_ICON.wood}" alt=""/>${cost.wood ?? 0}</span>
                <span class="tr-res-row"><img src="${RES_ICON.gold}" alt=""/>${cost.gold ?? 0}</span>
                ${foodLine}`;
              b.appendChild(iu); b.appendChild(txt);
              b.addEventListener("pointerdown", ev => {
                this.onPrimaryPointerActivate(ev, () => {
                  if (!afford) {
                    this.showToast(popBlock(me, popCost) ? "Population cap full" : "Not enough resources");
                    return;
                  }
                  this.env.enqueue({ kind: "train", player: this.env.myPlayerId, buildingId: selBuilding!.id, unit: u });
                });
              });
              trainRow.appendChild(b);
            });
            this.selectionPanel.appendChild(trainRow);
          }
          if (e.trainQueue.length) {
            const ql = document.createElement("h2");
            ql.className = "tr-hud-h2";
            ql.textContent = "Queue (click to cancel)";
            ql.style.marginTop = "12px";
            this.selectionPanel.appendChild(ql);
            const q = el("div", { display: "flex", gap: "8px", flexWrap: "wrap" });
            e.trainQueue.forEach((it, i) => {
              const slot = document.createElement("div");
              slot.className = "tr-queue-slot";
              const img = document.createElement("img");
              img.src = ICON_UNIT[it.unit];
              img.style.width = "100%"; img.style.height = "100%"; img.style.objectFit = "contain"; img.style.imageRendering = "pixelated";
              slot.appendChild(img);
              const pct = 1 - it.remaining / it.total;
              const fill = el("div", {
                position: "absolute", left: "0", bottom: "0", width: "100%",
                height: `${pct * 100}%`,
                background: "linear-gradient(0deg, rgba(245,207,90,.45), rgba(245,207,90,.08))",
                pointerEvents: "none",
              });
              slot.appendChild(fill);
              slot.title = `${labelize(it.unit)} — click to cancel`;
              slot.addEventListener("pointerdown", ev => {
                this.onPrimaryPointerActivate(ev, () => {
                  this.env.enqueue({ kind: "cancelTrain", player: this.env.myPlayerId, buildingId: selBuilding!.id, index: i });
                });
              });
              q.appendChild(slot);
            });
            this.selectionPanel.appendChild(q);
          }
        }
        return;
      }
    }

    if (representative) {
      let workerRole: WorkerRole | undefined;
      for (const id of sel) {
        const e = s.entities.get(id);
        if (isUnit(e) && e.unitKind === "pawn" && e.workerRole) {
          workerRole = e.workerRole;
          break;
        }
      }
      const row = el("div", { display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" });
      const img = document.createElement("img");
      img.src = ICON_UNIT[representative.kind as UnitKind];
      img.style.width = "48px"; img.style.height = "48px"; img.style.imageRendering = "pixelated";
      const col = el("div", { flex: "1" });
      const title = el("div", { fontSize: "20px", fontWeight: "800" });
      const roleBit = representative.kind === "pawn" && workerRole
        ? ` (${workerRoleLabel(workerRole)})`
        : "";
      title.textContent = `${labelize(representative.kind)}${roleBit}${sel.size > 1 ? `  ·  ${sel.size} selected` : ""}`;
      col.appendChild(title);
      if (units.size > 1 || (units.get(representative.kind) ?? 0) > 1) {
        const list = el("div", { fontSize: "13px", color: "#c2a76a", marginTop: "4px" });
        list.textContent = [...units.entries()].map(([k, n]) => `${n}× ${labelize(k)}`).join("   ·   ");
        col.appendChild(list);
      }
      const hpWrap = document.createElement("div");
      hpWrap.className = "tr-hp-bar";
      hpWrap.style.marginTop = "10px";
      hpWrap.style.maxWidth = "240px";
      const hpFill = document.createElement("div");
      hpFill.className = "tr-hp-bar__fill";
      hpFill.style.width = `${Math.max(0, Math.min(100, (representative.hp / representative.max) * 100))}%`;
      hpWrap.appendChild(hpFill);
      col.appendChild(hpWrap);
      if (this.selectionHasPawn()) {
        const bh = el("div", { marginTop: "10px", fontSize: "12px", color: "#a89878", lineHeight: "1.5" });
        bh.innerHTML = `<b>Build</b> — <b>Construct</b> on the left or <span class="tr-kbd">C</span>`;
        col.appendChild(bh);
      }
      row.appendChild(img); row.appendChild(col);
      this.selectionPanel.appendChild(row);
    }
  }

  private renderBuildPanel() {
    const s = this.env.state();
    const me = s.players[this.env.myPlayerId];
    const pawnIds: string[] = [];
    let hasPawn = false;
    for (const id of this.env.selection()) {
      const e = s.entities.get(id);
      if (isUnit(e) && e.unitKind === "pawn" && e.owner === this.env.myPlayerId) {
        hasPawn = true;
        pawnIds.push(`#${e.id}`);
      }
    }

    const anyPawn = this.anyOwnPawn();
    if (!anyPawn) {
      this.blueprintGridDirty = true;
      this.buildPanel.innerHTML = "";
      this.buildersInfo.textContent = "";
      this.buildSub.textContent = "Train pawns at a Builder hall to construct.";
      const t = el("div", {
        color: "#c2a76a", fontSize: "13px", gridColumn: "1 / -1", textAlign: "center",
        padding: "24px 8px", fontStyle: "italic",
      });
      t.textContent = "No workers on the field.";
      this.buildPanel.appendChild(t);
      return;
    }

    if (hasPawn) {
      const list = pawnIds.slice(0, 8).join(" ");
      const more = pawnIds.length > 8 ? ` +${pawnIds.length - 8}` : "";
      this.buildersInfo.innerHTML = `<span style="color:#c2a76a">Selected:</span> ${pawnIds.length} pawn(s) — <span style="color:#e8dcc4;font-family:ui-monospace,monospace">${list}</span>${more}`;
    } else {
      this.buildersInfo.innerHTML = `<span style="color:#c2a76a">Placement:</span> uses your <b>Builder</b> (or any pawn if no Builder). Select pawns to override.`;
    }

    this.buildSub.textContent = hasPawn
      ? "Choose a structure, then left-click the map. Selected pawns will gather and build."
      : "Choose a structure, then click the map. Your Builder leads unless you select other pawns first.";

    const needsGrid =
      this.blueprintGridDirty || this.buildPanel.querySelector("button[data-build-kind]") === null;
    if (needsGrid) {
      this.blueprintGridDirty = false;
      this.buildPanel.innerHTML = "";
      for (const k of BUILD_ORDER) {
        const stats = BUILDING_STATS[k];
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "tr-build-card";
        btn.dataset.buildKind = k;
        const hk = BUILD_HOTKEY[k] ?? "";
        const left = el("div", { display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" });
        const kbd = el("span", { className: "tr-kbd" });
        kbd.textContent = hk;
        const img = document.createElement("img");
        img.src = ICON_BUILD[k];
        img.draggable = false;
        img.style.width = "44px"; img.style.height = "44px"; img.style.imageRendering = "pixelated";
        left.appendChild(kbd); left.appendChild(img);

        const right = el("div", { flex: "1", minWidth: "0" });
        const name = el("div", { fontSize: "14px", fontWeight: "800" });
        name.textContent = BUILD_TITLE[k] ?? labelize(k);
        const cost = el("div", { fontSize: "11px", color: "#d4c4a4", marginTop: "4px", display: "flex", flexDirection: "column", gap: "2px" });
        cost.innerHTML = `
          <span class="tr-res-row"><img src="${RES_ICON.wood}" alt=""/>${stats.cost.wood} wood</span>
          <span class="tr-res-row"><img src="${RES_ICON.gold}" alt=""/>${stats.cost.gold} gold</span>`;
        right.appendChild(name); right.appendChild(cost);
        btn.appendChild(left); btn.appendChild(right);

        btn.addEventListener("click", ev => {
          ev.stopPropagation();
          const kind = (ev.currentTarget as HTMLButtonElement).dataset.buildKind as BuildingKind;
          const st = BUILDING_STATS[kind];
          const p = this.env.state().players[this.env.myPlayerId];
          const ok = p.resources.wood >= st.cost.wood && p.resources.gold >= st.cost.gold;
          if (!ok) {
            this.showToast(`Need ${st.cost.wood} wood and ${st.cost.gold} gold`);
            return;
          }
          this.env.setBuildMode({ building: kind });
        });
        this.buildPanel.appendChild(btn);
      }
    }
    this.updateBlueprintButtonAfford(me);
  }

  private updateBlueprintButtonAfford(me: Player) {
    for (const node of this.buildPanel.querySelectorAll("button[data-build-kind]")) {
      const btn = node as HTMLButtonElement;
      const k = btn.dataset.buildKind as BuildingKind;
      const stats = BUILDING_STATS[k];
      btn.disabled = me.resources.wood < stats.cost.wood || me.resources.gold < stats.cost.gold;
    }
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, style: Partial<CSSStyleDeclaration> & { className?: string }): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  const { className, ...rest } = style as any;
  if (className) e.className = className;
  Object.assign(e.style, rest);
  return e;
}

function labelize(s: string) { return s[0].toUpperCase() + s.slice(1); }

function workerRoleLabel(r: WorkerRole): string {
  if (r === "miner") return "Miner";
  if (r === "lumber") return "Lumberjack";
  return "Builder";
}

function formatTime(t: number) {
  const m = Math.floor(t / 60), sec = Math.floor(t % 60);
  return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
}

function countOwned(s: GameState, owner: number) {
  let n = 0;
  for (const e of s.entities.values()) if (isUnit(e) && e.owner === owner) n++;
  return n;
}

function popBlock(me: Player, popCost: number): boolean {
  return me.population + popCost > me.populationCap;
}
