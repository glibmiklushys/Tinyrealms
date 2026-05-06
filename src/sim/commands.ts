// Player intent expressed as commands. All player input — local OR remote —
// is converted to commands and fed into the deterministic tick. This is the
// bottleneck through which networked play will flow.

import type { BuildingKind, UnitKind } from "../config";
import type { EntityId, PlayerId, Vec2 } from "./state";

export type Command =
  // movement / combat
  | { kind: "move"; player: PlayerId; unitIds: EntityId[]; target: Vec2; queue?: boolean }
  | { kind: "attackMove"; player: PlayerId; unitIds: EntityId[]; target: Vec2 }
  | { kind: "attackTarget"; player: PlayerId; unitIds: EntityId[]; targetId: EntityId }
  | { kind: "stop"; player: PlayerId; unitIds: EntityId[] }
  | { kind: "hold"; player: PlayerId; unitIds: EntityId[] }
  // pawn
  | { kind: "gather"; player: PlayerId; unitIds: EntityId[]; nodeId: EntityId }
  | { kind: "buildPlace"; player: PlayerId; pawnIds: EntityId[]; building: BuildingKind; tile: { x: number; y: number } }
  | { kind: "assistBuild"; player: PlayerId; pawnIds: EntityId[]; siteId: EntityId }
  // monk
  | { kind: "heal"; player: PlayerId; unitIds: EntityId[]; targetId: EntityId }
  // production
  | { kind: "train"; player: PlayerId; buildingId: EntityId; unit: UnitKind }
  | { kind: "cancelTrain"; player: PlayerId; buildingId: EntityId; index: number }
  | { kind: "rally"; player: PlayerId; buildingId: EntityId; target: Vec2 }
  | { kind: "upgradeBuilding"; player: PlayerId; buildingId: EntityId };
