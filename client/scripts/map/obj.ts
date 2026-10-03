/**
 * OBJ input for the map pipeline: Matterport MatterPak, RealityCapture and Polycam OBJ
 * exports, i.e. a `.obj` plus the `.mtl` and texture JPGs/PNGs it references.
 *
 * The `obj2gltf` call lives only in this file and is loaded lazily from a runtime module
 * specifier, so importing this module (tests, tooling) never pulls the converter and the
 * conversion can be mocked or skipped. `loadObjDocument` hands back an in-memory glTF
 * Document, which callers run through the same normalize/collision path as GLB input.
 */
import path from 'node:path';

import type { Document, NodeIO } from '@gltf-transform/core';

/**
 * Held in a `string` on purpose: obj2gltf ships no type declarations, and a string literal
 * here would make `tsc` try (and fail) to resolve them.
 */
const OBJ2GLTF_MODULE: string = 'obj2gltf';

/** One binary glTF, with the OBJ's textures embedded in the GLB buffer. */
const OBJ2GLTF_OPTIONS = { binary: true };

type Obj2Gltf = (objPath: string, options: typeof OBJ2GLTF_OPTIONS) => Promise<Uint8Array>;

/** Printed when an OBJ is processed without an explicit --up. */
export const OBJ_UP_HINT =
	'OBJ scans (Matterpak, RealityCapture, Polycam) are usually Z-up; pass --up z if the map comes out lying on its side (the default stays y)';

/** Hint to print for an OBJ input, or null when the caller passed --up explicitly. */
export function objUpHint(upGiven: boolean): string | null {
	return upGiven ? null : OBJ_UP_HINT;
}

/** True for `.glb` / `.gltf` inputs, which NodeIO reads directly. */
export function isGltfPath(filePath: string): boolean {
	const extension = path.extname(filePath).toLowerCase();
	return extension === '.glb' || extension === '.gltf';
}

/** True for `.obj` inputs, which go through obj2gltf. */
export function isObjPath(filePath: string): boolean {
	return path.extname(filePath).toLowerCase() === '.obj';
}

/** Which pipeline branch an input file takes, or null when the format is unsupported. */
export function classifyInput(filePath: string): 'gltf' | 'obj' | null {
	if (isGltfPath(filePath)) return 'gltf';
	if (isObjPath(filePath)) return 'obj';
	return null;
}

async function importObj2Gltf(): Promise<Obj2Gltf> {
	const imported = (await import(OBJ2GLTF_MODULE)) as { default?: unknown };
	if (typeof imported.default !== 'function') {
		throw new Error('obj2gltf did not export a conversion function');
	}
	return imported.default as Obj2Gltf;
}

/**
 * Converts an OBJ (plus the `.mtl` and textures it references) into an in-memory glTF
 * Document. The path is resolved to absolute first, so obj2gltf finds `mtllib` and the
 * texture files relative to the OBJ instead of relative to the current directory.
 */
export async function loadObjDocument(objPath: string, io: NodeIO): Promise<Document> {
	const convert = await importObj2Gltf();
	const glb = await convert(path.resolve(objPath), OBJ2GLTF_OPTIONS);
	return io.readBinary(glb);
}
