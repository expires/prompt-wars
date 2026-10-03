/**
 * gltf-transform transform chains for the offline map pipeline (client/scripts/map).
 *
 * Raw venue scans arrive as millions of triangles with baked-in lighting and 4K+ textures -
 * far heavier than a browser FPS can stream. The visual chain shrinks geometry toward a
 * triangle budget, re-encodes textures to webp, marks every material unlit (the scan already
 * bakes lighting, so PBR lights would double-shade it) and meshopt-compresses the buffers.
 * The collision chain only simplifies: Rapier needs plain vertex/index buffers, and the
 * loader decodes meshopt either way.
 *
 * Runs on Node 26 with native type stripping: erasable syntax only, `.ts` import specifiers.
 */
import type { Document } from '@gltf-transform/core';
import { KHRMaterialsUnlit } from '@gltf-transform/extensions';
import { dedup, meshopt, simplify, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

import { simplifyRatio } from './lib.ts';

/** glTF TRIANGLES primitive mode. */
const TRIANGLES_MODE = 4;
/** Vertex-merge distance, in metres, applied before simplification. */
const WELD_TOLERANCE = 0.0001;
/** Relative error meshoptimizer may introduce while collapsing edges. */
const SIMPLIFY_ERROR = 0.01;

export type VisualOptimizeOptions = {
	/** Triangle budget for the visual mesh. */
	visualTris: number;
	/** Long-edge pixel budget for every texture. */
	maxTexture: number;
	/** Add KHR_materials_unlit to every material (scan lighting is baked in). */
	unlit: boolean;
	/** Apply EXT_meshopt_compression to the exported buffers. */
	meshopt: boolean;
};

export type VisualOptimizeResult = {
	/** Triangles before simplification (after dedup/weld). */
	trianglesBefore: number;
	/** Triangles after simplification. */
	trianglesAfter: number;
	/** Number of distinct textures in the document after the chain. */
	textures: number;
};

export type CollisionOptimizeResult = {
	trianglesBefore: number;
	trianglesAfter: number;
};

function triangleCount(document: Document): number {
	let total = 0;
	for (const mesh of document.getRoot().listMeshes()) {
		for (const primitive of mesh.listPrimitives()) {
			if (primitive.getMode() !== TRIANGLES_MODE) continue;
			const position = primitive.getAttribute('POSITION');
			if (!position) continue;
			const indices = primitive.getIndices();
			total += Math.floor((indices ? indices.getCount() : position.getCount()) / 3);
		}
	}
	return total;
}

/**
 * Merges duplicate vertices/primitives, then collapses geometry toward `budget` triangles
 * with meshoptimizer's simplifier. `simplifyRatio` clamps the ratio to (0, 1] so a scan that
 * already fits the budget is left alone.
 */
async function simplifyDocument(
	document: Document,
	budget: number,
	lockBorder: boolean,
): Promise<{ before: number; after: number }> {
	await dedup()(document);
	await weld({ tolerance: WELD_TOLERANCE })(document);

	const before = triangleCount(document);
	const ratio = simplifyRatio(before, budget);

	if (ratio < 1) {
		await MeshoptSimplifier.ready;
		await simplify({
			simplifier: MeshoptSimplifier,
			ratio,
			error: SIMPLIFY_ERROR,
			lockBorder,
		})(document);
	}

	return { before, after: triangleCount(document) };
}

/**
 * Visual chain: dedup -> weld -> meshoptimizer simplify toward `visualTris` (border vertices
 * locked, so texture seams survive) -> textures resized to `maxTexture` on the long edge and
 * re-encoded as webp -> unlit materials -> optional meshopt compression.
 */
export async function optimizeVisual(
	document: Document,
	options: VisualOptimizeOptions,
): Promise<VisualOptimizeResult> {
	const simplified = await simplifyDocument(document, options.visualTris, true);

	await textureCompress({
		encoder: sharp,
		targetFormat: 'webp',
		resize: [options.maxTexture, options.maxTexture],
		resizeFilter: 'lanczos3',
	})(document);

	if (options.unlit) {
		const unlit = document.createExtension(KHRMaterialsUnlit);
		for (const material of document.getRoot().listMaterials()) {
			material.setExtension('KHR_materials_unlit', unlit.createUnlit());
			// Photogrammetry scans are single-sided surfaces; rendering both sides (as the
			// Matterport viewer does) stops back-facing triangles reading as holes.
			material.setDoubleSided(true);
		}
	}

	if (options.meshopt) {
		await MeshoptEncoder.ready;
		await meshopt({ encoder: MeshoptEncoder })(document);
	}

	return {
		trianglesBefore: simplified.before,
		trianglesAfter: simplified.after,
		textures: document.getRoot().listTextures().length,
	};
}

/**
 * Collision chain: dedup -> weld -> meshoptimizer simplify toward `collisionTris` with
 * `lockBorder: false`. Never meshopt-compressed: Rapier reads plain buffers.
 */
export async function optimizeCollision(
	document: Document,
	collisionTris: number,
): Promise<CollisionOptimizeResult> {
	const simplified = await simplifyDocument(document, collisionTris, false);
	return { trianglesBefore: simplified.before, trianglesAfter: simplified.after };
}
