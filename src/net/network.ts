// Network abstraction. The local game uses a LocalNetwork that just buffers
// commands and runs the tick on this machine. A future WebRTC-based netcode
// will implement the same interface and exchange commands per-tick (lockstep)
// or apply rollback when needed.
//
// All inputs to the simulation flow through this layer. That makes future
// multiplayer integration mechanical: replace the implementation, keep
// everything else identical.

import type { Command } from "../sim/commands";

export interface Network {
  // Send a command originating from the local player.
  sendLocal(cmd: Command): void;
  // Pull all commands that should be applied at the given tick.
  // For LocalNetwork, this returns and clears the buffer immediately.
  // For lockstep netplay, this would block (or skip the tick) until ALL
  // peers have submitted commands for `tick + delay`.
  drain(tick: number): Command[];
  // Identity of this peer (player id) and total peers (1 = single-player).
  readonly localPlayerId: number;
  readonly numPlayers: number;
}

export class LocalNetwork implements Network {
  private buffer: Command[] = [];
  constructor(public readonly localPlayerId: number, public readonly numPlayers: number) {}
  sendLocal(cmd: Command): void { this.buffer.push(cmd); }
  drain(_tick: number): Command[] { const out = this.buffer; this.buffer = []; return out; }
}

// Stub for future:
// export class WebRTCLockstepNetwork implements Network {
//   constructor(private channel: RTCDataChannel, public readonly localPlayerId: number, public readonly numPlayers: number) {}
//   ...
// }
