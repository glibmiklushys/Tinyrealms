# Tiny Realms

A 2D real-time strategy skirmish game built on a **deterministic, command-driven simulation**. You vs an AI opponent. Gather wood and gold, build castles, train warriors and archers, and crush the enemy keep.

The architecture is intentionally **multiplayer-ready**: every player input becomes a `Command`, the simulation is a pure function of `(state, commands)` evaluated at a fixed 30 Hz tick, and a small `Network` interface sits in the only place where commands enter the loop. Dropping in WebRTC lockstep netplay later is a focused change.

## Run it

```bash
npm install
npm run dev
# → http://127.0.0.1:5173
```

Production build: `npm run build` then `npm run preview`.

## Controls

| Action                                      | Input                                          |
| ------------------------------------------- | ---------------------------------------------- |
| Pan camera                                  | `WASD` / Arrow keys / move mouse to screen edge |
| Pan with mouse                              | Middle-mouse drag                              |
| Zoom                                        | Mouse wheel                                    |
| Center on your castle                       | `Space`                                        |
| Select unit / building                      | Left-click                                     |
| Multi-select                                | Left-click and drag a box                      |
| Add to selection                            | `Shift` + click / drag                         |
| Move / attack / gather / build / heal       | Right-click (context-aware)                    |
| Set rally point on a building               | Select building, right-click destination        |
| Cancel selection / build placement          | `Escape`                                       |
| Build (with a Pawn selected)                | `H` House · `B` Barracks · `R` aRchery · `T` Tower · `M` Monastery |
| Stop                                        | `S` (with non-pawn unit selected)              |

The bottom panel shows a build menu when a Pawn is selected. Clicking any building you own opens a **train queue**; click queued items to cancel.

## Game design

- **Win condition**: destroy the enemy castle.
- **Resources**: Wood (chop trees), Gold (mine gold stones), Food (raise it via Houses; population cap).
- **Units**: Pawn (worker / builder / fighter), Warrior (melee), Archer (ranged), Lancer (fast melee), Monk (heals friendlies).
- **Buildings**: Castle (trains pawns), House (+4 food cap), Barracks (warriors / lancers), Archery (archers), Monastery (monks), Tower (auto-attacks enemies).

The starting kit lets you ramp from 3 pawns and a castle to a full army. The AI plays the same game with the same rules.

## Architecture

```
src/
  config.ts           tunable constants (stats, costs, tile size, sim rate)
  worldgen.ts         deterministic match setup (castles, pawns, resources)
  main.ts             boot, fixed-timestep loop

  sim/                The deterministic simulation core. NEVER touches DOM,
    rng.ts            seedable PRNG (mulberry32). Sim must NEVER call Math.random.
    state.ts          GameState shape, Player, Unit, Building, ResourceNode, Effect
    commands.ts       Command union — the ONLY way players modify state
    geom.ts           vector math
    spawn.ts          entity creation helpers
    tick.ts           runTick(state, commands) — pure step
    ai.ts             aiThink(state) — emits commands like a player

  net/
    network.ts        Network interface + LocalNetwork (single-player)
                      ← swap for WebRTCLockstepNetwork to add multiplayer

  render/             read-only over GameState; reconciles PixiJS sprites
    camera.ts         world ↔ screen
    map.ts            tile layer (procedural per seed)
    sprites.ts        SpriteWorld — mark-and-sweep sprite reconciliation
    overlay.ts        drag-select rect, build placement preview, minimap
    hud.ts            DOM overlay (top resource bar, bottom build/train panel)

  input/
    input.ts          mouse + keyboard → Commands; selection state
  assets.ts           asset manifest, sprite-sheet metadata, async loader
```

### Determinism rules

The simulation is a pure function of `(state_t, commands_at_t) → state_{t+1}`. To stay deterministic:

1. The sim only uses `state.rng` (mulberry32). Never `Math.random()`, `Date.now()`, or DOM/render-only inputs.
2. Iteration order over entities is the `Map` insertion order, which is consistent across V8 / SpiderMonkey / WebKit.
3. Floating-point inside the sim uses standard IEEE doubles in straight-line arithmetic — fine for a single-precision RTS once we use lockstep with the same JS engine on each peer.
4. The renderer **never writes** state. (`SpriteWorld.reconcile` is a pure read.)
5. The HUD **never writes** state. It only emits `Command`s through the network.

## Adding multiplayer (the plan)

`Network` is the only seam:

```ts
interface Network {
  sendLocal(cmd: Command): void;
  drain(tick: number): Command[];
  readonly localPlayerId: number;
  readonly numPlayers: number;
}
```

Today: `LocalNetwork` just buffers locally. To add 1v1 (or 4-player) lockstep:

1. **Signaling**: stand up a tiny WebSocket "matchmaker" (or use [PeerJS](https://peerjs.com/)) for SDP exchange. Players join a room, agree on a **seed**, **tickrate**, and an **input delay** (e.g. 4 ticks @ 30 Hz = 133 ms).
2. **Transport**: WebRTC `RTCDataChannel` with `ordered: true, maxRetransmits: 0` for command messages.
3. **Implementation**: `WebRTCLockstepNetwork`
   - On `sendLocal(cmd)`: timestamp it with `tick + delay`, broadcast `{tick, cmds}` to all peers (including self).
   - On `drain(tick)`: return only when **all peers** have submitted commands for that tick. If a peer is late, the local sim stalls (classic RTS lockstep). Add a 1-2 s tolerance UI ("waiting for player...").
4. **Resync**: every N ticks each peer hashes `state` (skip RNG `state`, sort entities by `id`, hash each entity's stable fields). Mismatch → desync; show the player a "desynced" banner. (For dev: log differences.)
5. **Reconnect**: store the command log; a returning peer can replay from tick 0 to catch up.

Because the simulation is already pure, deterministic, and bottlenecked through `Command`, **none of `sim/*`, `render/*`, or `hud/*` needs to change**. All the work is in `net/`.

### Why lockstep here (vs. authoritative)

RTS games push thousands of small unit updates and have very wide game state — replicating per-frame snapshots is bandwidth-prohibitive. Lockstep ships only **inputs** (a handful of bytes per second) and recomputes state on every peer. The trade-offs (input delay, hard requirement for determinism) match the genre well.

## Asset credits

This project uses the **Tiny Swords**-style 2D RTS asset pack supplied at `C:\Users\Viper\Documents\2d_game`. PNGs were copied to `public/assets/` with normalized paths (lowercase, underscores).

## Things that would be nice next

- **Pathfinding** that actually routes around obstacles (current code uses straight-line steering with separation; fine for open-field skirmishes, brittle around dense forests). Drop in a flow field or A* on a 64-px grid.
- **Fog of war** (per-team visibility). The architecture already supports this via per-team-cell visibility arrays in `GameState`.
- **More maps** — maps are just deterministic seed → world; `worldgen.ts` is the only place to extend.
- **Audio** — Howler.js + simple sfx triggered by `effect` entities.
- **Lockstep WebRTC netplay** — see the plan above.
- **Replays** — stream of `Command`s + initial seed already gives you free deterministic replays.
