import type { Vec2 } from "./state";

export const v = (x: number, y: number): Vec2 => ({ x, y });
export const vAdd = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const vSub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const vScale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const vLen = (a: Vec2): number => Math.hypot(a.x, a.y);
export const vDistSq = (a: Vec2, b: Vec2): number => { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; };
export const vDist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const vNorm = (a: Vec2): Vec2 => { const L = Math.hypot(a.x, a.y); return L < 1e-6 ? { x: 0, y: 0 } : { x: a.x / L, y: a.y / L }; };
export const clamp = (v: number, min: number, max: number): number => v < min ? min : v > max ? max : v;
