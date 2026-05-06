// Tiny Realms — entry point.
// Boot order:
//   1) Create PixiJS Application + Camera
//   2) Load all assets (with progress)
//   3) Build initial deterministic GameState (map, players, entities)
//   4) Wire up renderer + input + HUD + AI + network
//   5) Run a fixed-timestep simulation loop, render every frame
//
// The simulation is decoupled from rendering: tick() runs at SIM_HZ regardless
// of frame-rate. The renderer reads the current state every frame and lerps
// for visual smoothness via PixiJS sprite tweens are not required here because
// the sim runs at 30 Hz which is plenty for a top-down RTS.

import { Application, Container } from "pixi.js";
import { loadAllAssets } from "./assets";
import { SIM_DT } from "./config";
import { Input } from "./input/input";
import { LocalNetwork } from "./net/network";
import { aiThink } from "./sim/ai";
import { makeInitialState, makePlayer } from "./sim/state";
import { runTick } from "./sim/tick";
import { Camera } from "./render/camera";
import { HUD } from "./render/hud";
import { buildMapLayer, generateMap } from "./render/map";
import { Minimap, WorldOverlay } from "./render/overlay";
import { SpriteWorld } from "./render/sprites";
import { setupMatch } from "./worldgen";

async function main() {
  const fillEl = document.getElementById("loading-fill") as HTMLDivElement;
  const loadingEl = document.getElementById("loading") as HTMLDivElement;

  // 1) PixiJS application
  const app = new Application();
  await app.init({
    background: "#0d1727",
    resizeTo: window,
    antialias: false,
    powerPreference: "high-performance",
  });
  const host = document.getElementById("game")!;
  host.appendChild(app.canvas);

  // 2) Load assets
  const cache = await loadAllAssets(p => { fillEl.style.width = `${Math.round(p * 100)}%`; });
  loadingEl.style.display = "none";

  // World-space root (panned/zoomed by camera)
  const worldRoot = new Container();
  worldRoot.label = "world";
  app.stage.addChild(worldRoot);

  // Screen-space root (HUD overlays — minimap)
  const screenRoot = new Container();
  screenRoot.label = "screen";
  app.stage.addChild(screenRoot);

  // 3) Build initial state + map
  const seed = (Math.random() * 2 ** 31) | 0;
  let state = makeInitialState(seed);
  state.players.push(
    makePlayer(0, "You",   "blue", 0, true),
    makePlayer(1, "Foe",   "red",  1, false),
  );
  setupMatch(state, seed);

  // map layer
  const mapData = generateMap(seed);
  worldRoot.addChild(buildMapLayer(mapData, cache, seed));

  // sprite world
  const sprites = new SpriteWorld(cache);
  sprites.addToWorld(worldRoot);

  // overlays
  const overlay = new WorldOverlay(cache);
  worldRoot.addChild(overlay.root);

  // minimap
  const minimap = new Minimap();
  screenRoot.addChild(minimap.root);

  // 4) Camera + input + HUD
  const camera = new Camera(state.mapW, state.mapH);
  camera.resize(app.renderer.width, app.renderer.height);
  // Center on player castle
  for (const e of state.entities.values()) {
    if (e.kind === "building" && e.owner === 0 && e.buildingKind === "castle") { camera.centerOn(e.pos.x, e.pos.y); break; }
  }
  window.addEventListener("resize", () => camera.resize(app.renderer.width, app.renderer.height));

  const network = new LocalNetwork(0, 1);

  const hud = new HUD({
    myPlayerId: 0,
    enqueue: cmd => network.sendLocal(cmd),
    setBuildMode: bm => { input.state.buildMode = bm; hud.setBuildModeIndicator(bm); },
    state: () => state,
    selection: () => input.state.selection,
    buildMode: () => input.state.buildMode,
    hoverTile: () => input.state.hoverTile,
  });

  const input = new Input({
    canvas: app.canvas,
    camera,
    state: () => state,
    myPlayerId: 0,
    enqueue: cmd => network.sendLocal(cmd),
    onSelectionChange: sel => sprites.setSelection(sel),
    onBuildModeChange: bm => hud.setBuildModeIndicator(bm),
    onEsc: () => hud.closeBuildMenu(),
    onToggleBuildMenu: () => hud.toggleBuildMenu(),
    onCannotPlaceBuild: () => hud.showToast("No workers available to build"),
  });

  // 5) Game loop with fixed-timestep simulation
  let acc = 0;
  let lastT = performance.now();
  let endShown = false;

  app.ticker.add(() => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastT) / 1000);
    lastT = now;
    acc += dt;

    // simulation: run one or more ticks to catch up
    let safety = 6;
    while (acc >= SIM_DT && safety-- > 0) {
      // gather commands: local + AI (AI runs inside sim by emitting commands too)
      const localCmds = network.drain(state.tick);
      const aiCmds = aiThink(state);
      runTick(state, [...localCmds, ...aiCmds]);
      acc -= SIM_DT;
    }
    if (safety === 0) acc = 0;

    // input pre-render (camera pan via keys / edge-pan)
    input.tick(dt);

    // apply camera transform
    worldRoot.scale.set(camera.zoom);
    worldRoot.x = -camera.x * camera.zoom;
    worldRoot.y = -camera.y * camera.zoom;

    // reconcile sprites + overlays + minimap
    sprites.reconcile(state);
    overlay.update(input, state, camera, 0);
    minimap.root.x = app.renderer.width - minimap.size.w - 16;
    minimap.root.y = 80;
    minimap.update(state, camera);

    // HUD
    hud.update();

    // end screen
    if (state.outcome.over && !endShown) {
      endShown = true;
      const won = state.outcome.winner === 0;
      hud.showEndScreen(won, () => location.reload());
    }
  });

  // prevent default selection behavior on the page
  document.body.addEventListener("dragstart", e => e.preventDefault());
}

main().catch(err => {
  console.error(err);
  const loadingEl = document.getElementById("loading");
  if (loadingEl) loadingEl.innerHTML = `<div style="color:#f5a89c;font-family:monospace;padding:20px">Failed to start: ${String(err)}</div>`;
});
