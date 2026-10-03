import type * as THREE from 'three';

/**
 * Part registry. buildWeaponModel() resolves partIds through here, so the big
 * `@ai-gaem/parts` library can plug in via registerParts(). The built-in kit in
 * ./parts.ts is registered as a fallback.
 *
 * Conventions: weapon local space has the barrel pointing toward -Z, +Y up.
 * A part's build() output has its origin at the point where it plugs into the
 * parent socket.
 */
export type Vec3 = [number, number, number];

export interface Socket {
  pos: Vec3;
  /** direction the child extends in (informational; default -Z) */
  dir?: Vec3;
}

export interface PartBuildOpts {
  color?: string;
  accent?: string;
  scale?: number;
}

export interface PartDef {
  id: string;
  /** 'core' parts are roots (receiver/body/handle for melee) placed at origin */
  category: string;
  classes: string[];
  tags: string[];
  desc: string;
  /** socket name on a parent this part plugs into: 'barrel', 'muzzle', 'stock', 'grip', 'mag', 'top', 'under', ... */
  attach: string;
  /** sockets this part exposes for children (positions in this part's local space) */
  sockets: Record<string, Socket>;
  build(opts: PartBuildOpts): THREE.Object3D;
}

/** Shape of an external registry (e.g. exported by @ai-gaem/parts). */
export interface PartRegistryLike {
  getPart(id: string): PartDef | undefined;
  listParts?(): PartDef[];
}

const registry = new Map<string, PartDef>();

export function registerParts(defs: PartDef[]): void {
  for (const d of defs) registry.set(d.id, d);
}

/** Plug in a whole external registry: copies all its parts if it can list them. */
export function registerRegistry(ext: PartRegistryLike): void {
  if (ext.listParts) registerParts(ext.listParts());
  externals.push(ext);
}

const externals: PartRegistryLike[] = [];

export function getPart(id: string): PartDef | undefined {
  const local = registry.get(id);
  if (local) return local;
  for (const ext of externals) {
    const p = ext.getPart(id);
    if (p) return p;
  }
  return undefined;
}

/** true if the id is one of the built-in fallback kit parts (./parts.ts), not an external library part */
export function isLocalPart(id: string): boolean {
  return registry.has(id);
}

export function listParts(): PartDef[] {
  return [...registry.values()];
}
