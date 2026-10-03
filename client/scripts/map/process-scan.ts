#!/usr/bin/env node
/**
 * Offline map pipeline: raw venue scan (Polycam / Scaniverse / Matterport export) in,
 * game-ready GLBs out for the loader in client/src/map/loadMap.ts:
 *
 *   <out>/<id>.glb            normalized visual mesh, simplified + webp textures + unlit + meshopt
 *   <out>/<id>_collision.glb  merged + welded POSITION/indices only, small islands removed, simplified
 *   <out>/<id>.meta.json      { id, source, up, scale, bbox, visualTrisBefore, visualTris,
 *                               collisionTris, textures, unlit, meshopt, createdAt }
 *
 *   node client/scripts/map/process-scan.ts <in.glb|in.gltf|in.obj> --name <id> [--up y|z] [--scale <n>] [--out <dir>]
 *
 * OBJ inputs (.obj + .mtl + texture images) are converted in memory by obj.ts and then share
 * this whole path. Matterpak OBJs are Z-up: pass --up z for them.
 *
 * Runs on Node 26 with native type stripping: erasable syntax only, `.ts` import specifiers.
 */
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { Document, NodeIO } from '@gltf-transform/core';
import type { Accessor, Mesh, Node, Scene } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { flatten, prune, transformMesh, weld } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';

import {
	axisMatrix,
	boundsSize,
	countTriangles,
	emptyBounds,
	filterIslands,
	growBounds,
	identityMatrix,
	isEmptyBounds,
	multiply,
	recenterOffset,
	scaleMatrix,
	translationMatrix,
} from './lib.ts';
import type { Bounds, Mat4, UpAxis, Vec3 } from './lib.ts';
import { classifyInput, loadObjDocument, objUpHint } from './obj.ts';
import { optimizeCollision, optimizeVisual } from './optimize.ts';

/** glTF TRIANGLES primitive mode. */
const TRIANGLES_MODE = 4;

const DEFAULT_OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/maps');
const DEFAULT_VISUAL_TRIS = 400000;
const DEFAULT_COLLISION_TRIS = 80000;
const DEFAULT_MAX_TEXTURE = 2048;

const USAGE = `Usage: node client/scripts/map/process-scan.ts <in.glb|in.gltf|in.obj> --name <id> [options]

Options:
  --name <id>              Map id; writes <id>.glb, <id>_collision.glb and <id>.meta.json
  --up <y|z>               Up axis of the source scan (default: y). "z" rotates -90deg about X.
                           OBJ exports (Matterpak, RealityCapture, Polycam) are usually Z-up
  --scale <n>              Uniform scale applied to the scan (default: 1)
  --out <dir>              Output directory (default: client/public/maps)
  --min-island-tris <n>    Drop collision islands smaller than n triangles (default: 50)
  --visual-tris <n>        Visual triangle budget for meshoptimizer simplify (default: 400000)
  --collision-tris <n>     Collision triangle budget for meshoptimizer simplify (default: 80000)
  --max-texture <n>        Long-edge pixel budget for every texture (default: 2048)
  --unlit / --no-unlit     Mark materials unlit; scan lighting is baked in (default: unlit)
  --meshopt / --no-meshopt Apply EXT_meshopt_compression to the visual GLB (default: meshopt)
  --help                   Print this message

Inputs:
  .glb / .gltf             read directly
  .obj                     converted in memory (obj2gltf, binary glTF); the .mtl and textures
                           are resolved next to the OBJ file`;

type CliOptions = {
	input: string;
	name: string;
	up: UpAxis;
	upGiven: boolean;
	scale: number;
	outDir: string;
	minIslandTris: number;
	visualTris: number;
	collisionTris: number;
	maxTexture: number;
	unlit: boolean;
	meshopt: boolean;
};

type GeometryChunk = { positions: Float32Array; indices: Uint32Array };

type CollisionResult = {
	triangleCount: number;
	removedTriangles: number;
	islandCount: number;
	keptIslands: number;
};

function fail(message: string): never {
	console.error(`process-scan: ${message}\n`);
	console.error(USAGE);
	process.exit(1);
}

function parseNumber(raw: string | undefined, fallback: number, flag: string): number {
	if (raw === undefined) return fallback;
	const value = Number(raw);
	if (!Number.isFinite(value)) fail(`${flag} expects a number, got "${raw}"`);
	return value;
}

/** Positive-integer budget flag (`--visual-tris`, `--max-texture`, ...). */
function parseBudget(raw: string | undefined, fallback: number, flag: string): number {
	const value = Math.round(parseNumber(raw, fallback, flag));
	if (!(value >= 1)) fail(`${flag} must be at least 1, got ${raw}`);
	return value;
}

function parseCliArgs(argv: string[]): CliOptions {
	const { values, positionals } = parseArgs({
		args: argv,
		allowPositionals: true,
		allowNegative: true,
		options: {
			name: { type: 'string' },
			up: { type: 'string' },
			scale: { type: 'string' },
			out: { type: 'string' },
			'min-island-tris': { type: 'string' },
			'visual-tris': { type: 'string' },
			'collision-tris': { type: 'string' },
			'max-texture': { type: 'string' },
			unlit: { type: 'boolean' },
			meshopt: { type: 'boolean' },
			help: { type: 'boolean', short: 'h' },
		},
	});

	if (values.help) {
		console.log(USAGE);
		process.exit(0);
	}
	if (positionals.length !== 1) {
		fail(`expected exactly one input file, got ${positionals.length}`);
	}

	const input = positionals[0];
	const name = values.name;
	if (!name) fail('--name is required');
	if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name)) fail(`--name "${name}" is not a valid map id`);

	const up = values.up ?? 'y';
	if (up !== 'y' && up !== 'z') fail(`--up must be "y" or "z", got "${up}"`);

	const scale = parseNumber(values.scale, 1, '--scale');
	if (!(scale > 0)) fail(`--scale must be greater than 0, got ${scale}`);

	const minIslandTris = parseNumber(values['min-island-tris'], 50, '--min-island-tris');
	if (!(minIslandTris >= 1)) fail(`--min-island-tris must be at least 1, got ${minIslandTris}`);

	return {
		input,
		name,
		up,
		upGiven: values.up !== undefined,
		scale,
		outDir: values.out ? path.resolve(values.out) : DEFAULT_OUT_DIR,
		minIslandTris: Math.round(minIslandTris),
		visualTris: parseBudget(values['visual-tris'], DEFAULT_VISUAL_TRIS, '--visual-tris'),
		collisionTris: parseBudget(values['collision-tris'], DEFAULT_COLLISION_TRIS, '--collision-tris'),
		maxTexture: parseBudget(values['max-texture'], DEFAULT_MAX_TEXTURE, '--max-texture'),
		unlit: values.unlit ?? true,
		meshopt: values.meshopt ?? true,
	};
}

function* walkNode(node: Node): Generator<Node> {
	yield node;
	for (const child of node.listChildren()) yield* walkNode(child);
}

function* walkScene(scene: Scene): Generator<Node> {
	for (const child of scene.listChildren()) yield* walkNode(child);
}

/**
 * Pre-multiplies the transform of every scene root. Call after `flatten()`, so each root
 * node's local matrix is also its world matrix, and nested nodes inherit the change.
 */
function applyToSceneRoots(scene: Scene, matrix: Mat4): void {
	const m = Float32Array.from(matrix);
	for (const node of scene.listChildren()) {
		node.setMatrix(Float32Array.from(multiply(m, node.getMatrix())));
	}
}

/**
 * Bakes each node's world matrix into its mesh vertices (transformMesh mutates in place)
 * and resets the node transform, so the exported GLB has no transform hierarchy. A mesh
 * shared by several nodes keeps its node transforms: transformMesh cannot be applied twice.
 */
function bakeNodeTransforms(scene: Scene): void {
	const usage = new Map<Mesh, number>();
	for (const node of walkScene(scene)) {
		const mesh = node.getMesh();
		if (mesh) usage.set(mesh, (usage.get(mesh) ?? 0) + 1);
	}
	for (const node of walkScene(scene)) {
		const mesh = node.getMesh();
		if (!mesh || (usage.get(mesh) ?? 0) > 1) continue;
		transformMesh(mesh, node.getWorldMatrix());
		node.setMatrix(Float32Array.from(identityMatrix()));
	}
}

/** Bounding box of the scene's baked vertex positions. */
function measureBounds(scene: Scene): Bounds {
	const bounds = emptyBounds();
	const point: Vec3 = [0, 0, 0];
	for (const node of walkScene(scene)) {
		const mesh = node.getMesh();
		if (!mesh) continue;
		for (const primitive of mesh.listPrimitives()) {
			const array = primitive.getAttribute('POSITION')?.getArray();
			if (!array) continue;
			for (let i = 0; i < array.length; i += 3) {
				point[0] = array[i];
				point[1] = array[i + 1];
				point[2] = array[i + 2];
				growBounds(bounds, point);
			}
		}
	}
	return bounds;
}

function countSceneTriangles(scene: Scene): number {
	let total = 0;
	for (const node of walkScene(scene)) {
		const mesh = node.getMesh();
		if (!mesh) continue;
		for (const primitive of mesh.listPrimitives()) {
			const position = primitive.getAttribute('POSITION');
			if (!position) continue;
			const indices = primitive.getIndices()?.getArray() ?? null;
			total += countTriangles(indices, position.getCount(), primitive.getMode());
		}
	}
	return total;
}

/** Flattens every scene primitive into plain POSITION/index arrays (call after baking). */
function collectGeometry(scene: Scene): GeometryChunk[] {
	const chunks: GeometryChunk[] = [];
	for (const node of walkScene(scene)) {
		const mesh = node.getMesh();
		if (!mesh) continue;
		for (const primitive of mesh.listPrimitives()) {
			const array = primitive.getAttribute('POSITION')?.getArray();
			if (!array) continue;
			if (primitive.getMode() !== TRIANGLES_MODE) continue;

			const vertexCount = array.length / 3;
			const source = primitive.getIndices()?.getArray() ?? null;
			const indices = new Uint32Array(source ? source.length : vertexCount);
			for (let i = 0; i < indices.length; i++) indices[i] = source ? source[i] : i;

			chunks.push({ positions: Float32Array.from(array), indices });
		}
	}
	return chunks;
}

function mergeGeometry(chunks: GeometryChunk[]): { positions: Float32Array; indices: Uint32Array } {
	let vertexCount = 0;
	let indexCount = 0;
	for (const chunk of chunks) {
		vertexCount += chunk.positions.length / 3;
		indexCount += chunk.indices.length;
	}

	const positions = new Float32Array(vertexCount * 3);
	const indices = new Uint32Array(indexCount);
	let vertexOffset = 0;
	let indexOffset = 0;
	for (const chunk of chunks) {
		positions.set(chunk.positions, vertexOffset * 3);
		for (let i = 0; i < chunk.indices.length; i++) {
			indices[indexOffset + i] = chunk.indices[i] + vertexOffset;
		}
		vertexOffset += chunk.positions.length / 3;
		indexOffset += chunk.indices.length;
	}
	return { positions, indices };
}

/** glTF requires min/max on POSITION accessors; set them when the API exposes it. */
function setAccessorBounds(accessor: Accessor, array: ArrayLike<number>): void {
	const target = accessor as Accessor & {
		setMin?: (value: number[]) => unknown;
		setMax?: (value: number[]) => unknown;
	};
	if (typeof target.setMin !== 'function' || typeof target.setMax !== 'function') return;

	const min = [Infinity, Infinity, Infinity];
	const max = [-Infinity, -Infinity, -Infinity];
	for (let i = 0; i < array.length; i += 3) {
		for (let axis = 0; axis < 3; axis++) {
			const value = array[i + axis];
			if (value < min[axis]) min[axis] = value;
			if (value > max[axis]) max[axis] = value;
		}
	}
	target.setMin(min);
	target.setMax(max);
}

/**
 * Builds the collision mesh: every visual primitive merged into a single POSITION + indices
 * primitive (no materials, textures, normals or UVs), welded, then stripped of disconnected
 * islands smaller than `minIslandTris`. Triangle-budget simplification happens afterwards in
 * `optimizeCollision` (meshoptimizer, `lockBorder: false`), where the visual chain is applied
 * to the visual document.
 */
function buildCollisionDocument(
	scene: Scene,
	minIslandTris: number,
): { document: Document; result: CollisionResult } {
	const merged = mergeGeometry(collectGeometry(scene));

	const collision = new Document();
	const buffer = collision.createBuffer();
	const positionAccessor = collision
		.createAccessor('POSITION')
		.setType('VEC3')
		.setBuffer(buffer)
		.setArray(merged.positions);
	const indexAccessor = collision
		.createAccessor('indices')
		.setType('SCALAR')
		.setBuffer(buffer)
		.setArray(merged.indices);

	const primitive = collision
		.createPrimitive()
		.setAttribute('POSITION', positionAccessor)
		.setIndices(indexAccessor);
	const mesh = collision.createMesh('collision').addPrimitive(primitive);
	const node = collision.createNode('collision').setMesh(mesh);
	const collisionScene = collision.createScene('Scene').addChild(node);
	collision.getRoot().setDefaultScene(collisionScene);

	weld({ tolerance: 0.0001 })(collision);
	prune()(collision);

	const weldedMesh = collision.getRoot().listMeshes()[0];
	const weldedPrimitive = weldedMesh.listPrimitives()[0];
	const weldedPositions = weldedPrimitive.getAttribute('POSITION');
	const weldedIndices = weldedPrimitive.getIndices();
	if (!weldedPositions || !weldedIndices) {
		throw new Error('collision primitive lost its POSITION or indices while welding');
	}

	const filtered = filterIslands(weldedIndices.getArray(), minIslandTris);
	if (filtered.removedTriangles > 0) weldedIndices.setArray(filtered.indices);

	const weldedArray = weldedPositions.getArray();
	if (weldedArray) setAccessorBounds(weldedPositions, weldedArray);

	return {
		document: collision,
		result: {
			triangleCount: filtered.triangleCount,
			removedTriangles: filtered.removedTriangles,
			islandCount: filtered.islandCount,
			keptIslands: filtered.keptIslands,
		},
	};
}

function round(value: number): number {
	return Math.round(value * 1000) / 1000;
}

/** File size in megabytes, used to report before/after scan weight. */
async function fileSizeMB(filePath: string): Promise<number> {
	const info = await stat(filePath);
	return info.size / (1024 * 1024);
}

async function main(): Promise<void> {
	const options = parseCliArgs(process.argv.slice(2));
	// EXT_meshopt_compression needs the encoder installed on the IO for the deferred write step.
	const io = new NodeIO()
		.registerExtensions(ALL_EXTENSIONS)
		.registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

	const kind = classifyInput(options.input);
	if (kind === null) {
		fail(
			`unsupported input "${options.input}": expected a .glb, .gltf or .obj file ` +
				'(.obj scans need their .mtl and textures next to the OBJ)',
		);
	}
	if (kind === 'obj') {
		const hint = objUpHint(options.upGiven);
		if (hint) console.warn(`process-scan: ${hint}`);
	}

	const document =
		kind === 'obj' ? await loadObjDocument(options.input, io) : await io.read(options.input);
	const root = document.getRoot();
	let scene = root.getDefaultScene();
	if (!scene) {
		scene = document.createScene('Scene');
		for (const node of root.listNodes()) {
			if (!node.getParentNode()) scene.addChild(node);
		}
		root.setDefaultScene(scene);
	}

	const sourceTriangles = countSceneTriangles(scene);

	// 1. Orientation (--up) and --scale, applied to the scene roots then baked into vertices.
	applyToSceneRoots(scene, multiply(scaleMatrix(options.scale), axisMatrix(options.up)));
	flatten()(document);
	bakeNodeTransforms(scene);

	// 2. Ground the scan: bbox min.y -> 0, XZ centre -> origin.
	const oriented = measureBounds(scene);
	if (isEmptyBounds(oriented)) fail(`no triangle geometry found in ${options.input}`);
	applyToSceneRoots(scene, translationMatrix(recenterOffset(oriented)));
	bakeNodeTransforms(scene);

	const bounds = measureBounds(scene);

	// 3. Build the collision mesh from the normalized scan, then run both optimize chains.
	const collision = buildCollisionDocument(scene, options.minIslandTris);
	const visual = await optimizeVisual(document, {
		visualTris: options.visualTris,
		maxTexture: options.maxTexture,
		unlit: options.unlit,
		meshopt: options.meshopt,
	});
	const collisionOptimized = await optimizeCollision(collision.document, options.collisionTris);

	await mkdir(options.outDir, { recursive: true });
	const visualPath = path.join(options.outDir, `${options.name}.glb`);
	const collisionPath = path.join(options.outDir, `${options.name}_collision.glb`);
	const metaPath = path.join(options.outDir, `${options.name}.meta.json`);

	await io.write(visualPath, document);
	await io.write(collisionPath, collision.document);

	const meta = {
		id: options.name,
		source: options.input,
		up: options.up,
		scale: options.scale,
		bbox: {
			min: [round(bounds.min[0]), round(bounds.min[1]), round(bounds.min[2])],
			max: [round(bounds.max[0]), round(bounds.max[1]), round(bounds.max[2])],
		},
		visualTrisBefore: visual.trianglesBefore,
		visualTris: visual.trianglesAfter,
		collisionTris: collisionOptimized.trianglesAfter,
		textures: visual.textures,
		unlit: options.unlit,
		meshopt: options.meshopt,
		createdAt: new Date().toISOString(),
	};
	await writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');

	const sourceMB = await fileSizeMB(options.input);
	const visualMB = await fileSizeMB(visualPath);
	const collisionMB = await fileSizeMB(collisionPath);
	const size = boundsSize(bounds);

	console.log(`Map pipeline complete: ${options.name}`);
	console.log(`  source      ${options.input}`);
	console.log(`  out         ${options.outDir}`);
	console.log(`  up / scale  ${options.up} / ${options.scale}`);
	console.log(
		`  tris        visual ${visual.trianglesAfter} (source ${sourceTriangles}, before ${visual.trianglesBefore}, budget ${options.visualTris})`,
	);
	console.log(
		`  collision   ${collisionOptimized.trianglesAfter} (before ${collisionOptimized.trianglesBefore}, budget ${options.collisionTris})`,
	);
	console.log(
		`  islands     ${collision.result.keptIslands}/${collision.result.islandCount} kept, ${collision.result.removedTriangles} tris removed (< ${options.minIslandTris} tris)`,
	);
	console.log(
		`  textures    ${visual.textures} <= ${options.maxTexture}px webp, unlit ${options.unlit}, meshopt ${options.meshopt}`,
	);
	console.log(
		`  bbox (m)    ${size[0].toFixed(2)} x ${size[1].toFixed(2)} x ${size[2].toFixed(2)} (min.y = 0, XZ centred)`,
	);
	console.log(
		`  size (MB)   source ${sourceMB.toFixed(1)} -> visual ${visualMB.toFixed(1)} + collision ${collisionMB.toFixed(1)}`,
	);
	console.log(
		`  wrote       ${path.basename(visualPath)}, ${path.basename(collisionPath)}, ${path.basename(metaPath)}`,
	);
}

main().catch((error: unknown) => {
	console.error(`process-scan: ${error instanceof Error ? error.message : String(error)}`);
	if (error instanceof Error && error.stack) console.error(error.stack);
	process.exit(1);
});
