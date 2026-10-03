import assert from 'node:assert/strict';
import test from 'node:test';

import {
	applyMatrix,
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
	simplifyRatio,
	translationMatrix,
} from './lib.ts';
import type { Mat4, Vec3 } from './lib.ts';
import { classifyInput, isGltfPath, isObjPath, OBJ_UP_HINT, objUpHint } from './obj.ts';

const EPSILON = 1e-9;

/** Component-wise float comparison; deepEqual would trip over -0 vs 0. */
function assertVec(actual: Vec3, expected: Vec3, epsilon = EPSILON): void {
	for (let i = 0; i < 3; i++) {
		assert.ok(
			Math.abs(actual[i] - expected[i]) <= epsilon,
			`expected [${actual.join(', ')}] to equal [${expected.join(', ')}]`,
		);
	}
}

function assertMatrix(actual: Mat4, expected: Mat4): void {
	for (let i = 0; i < 16; i++) {
		assert.ok(
			Math.abs(actual[i] - expected[i]) <= EPSILON,
			`matrix[${i}]: ${actual[i]} !== ${expected[i]}`,
		);
	}
}

test('identityMatrix leaves points unchanged', () => {
	assertVec(applyMatrix(identityMatrix(), [1.5, -2, 3]), [1.5, -2, 3]);
});

test('axisMatrix("y") is the identity', () => {
	assertMatrix(axisMatrix('y'), identityMatrix());
});

test('axisMatrix("z") rotates -90deg about X so Z-up becomes Y-up', () => {
	assertVec(applyMatrix(axisMatrix('z'), [1, 0, 0]), [1, 0, 0]);
	assertVec(applyMatrix(axisMatrix('z'), [0, 0, 1]), [0, 1, 0]);
	assertVec(applyMatrix(axisMatrix('z'), [0, 1, 0]), [0, 0, -1]);
	assertVec(applyMatrix(axisMatrix('z'), [4, 5, 6]), [4, 6, -5]);
});

test('multiply applies the right operand first', () => {
	const m = multiply(translationMatrix([1, 2, 3]), scaleMatrix(2));
	assertVec(applyMatrix(m, [1, 0, 0]), [3, 2, 3]);
});

test('scaleMatrix and translationMatrix compose with the point', () => {
	const m = multiply(scaleMatrix(0.5), translationMatrix([2, -4, 6]));
	assertVec(applyMatrix(m, [2, 0, 0]), [2, -2, 3]);
});

test('growBounds accumulates points and boundsSize reports extents', () => {
	const bounds = emptyBounds();
	assert.equal(isEmptyBounds(bounds), true);

	growBounds(bounds, [1, 2, 3]);
	growBounds(bounds, [-1, 5, 0]);

	assert.equal(isEmptyBounds(bounds), false);
	assert.deepEqual(bounds.min, [-1, 2, 0]);
	assert.deepEqual(bounds.max, [1, 5, 3]);
	assert.deepEqual(boundsSize(bounds), [2, 3, 3]);
});

test('recenterOffset puts min.y on 0 and the XZ centre on the origin', () => {
	const offset = recenterOffset({ min: [-2, -1.5, 4], max: [4, 3.5, 10] });
	assertVec(offset, [-1, 1.5, -7]);
});

test('countTriangles handles indexed, non-indexed and non-triangle modes', () => {
	assert.equal(countTriangles(new Uint32Array([0, 1, 2, 2, 3, 0]), 4), 2);
	assert.equal(countTriangles(null, 12), 4);
	assert.equal(countTriangles(undefined, 3), 1);
	assert.equal(countTriangles(new Uint32Array([0, 1, 1, 2]), 4, 1), 0);
});

test('simplifyRatio returns 1 when the mesh already fits the budget', () => {
	assert.equal(simplifyRatio(1_000, 400_000), 1);
	assert.equal(simplifyRatio(400_000, 400_000), 1);
});

test('simplifyRatio scales the current triangle count down to the budget', () => {
	assert.equal(simplifyRatio(1_000_000, 400_000), 0.4);
	assert.equal(simplifyRatio(200_000, 80_000), 0.4);
	assert.equal(simplifyRatio(3, 1), 1 / 3);
});

test('simplifyRatio stays within (0, 1] for degenerate inputs', () => {
	assert.equal(simplifyRatio(0, 400_000), 1);
	assert.equal(simplifyRatio(1_000_000, 0), 1);
	assert.equal(simplifyRatio(1_000_000, -5), 1);

	const tiny = simplifyRatio(1e12, 1);
	assert.ok(tiny > 0 && tiny <= 1, `ratio ${tiny} out of range`);
});

test('filterIslands removes small disconnected islands', () => {
	// 3-triangle sheet, a lone triangle, then a 4-triangle sheet.
	const indices = new Uint32Array([
		0, 1, 2, 2, 1, 3, 3, 1, 4,
		10, 11, 12,
		20, 21, 22, 22, 21, 23, 23, 21, 24, 24, 21, 25,
	]);

	const result = filterIslands(indices, 3);

	assert.equal(result.triangleCount, 7);
	assert.equal(result.removedTriangles, 1);
	assert.equal(result.islandCount, 3);
	assert.equal(result.keptIslands, 2);
	assert.deepEqual(Array.from(result.indices), [
		0, 1, 2, 2, 1, 3, 3, 1, 4,
		20, 21, 22, 22, 21, 23, 23, 21, 24, 24, 21, 25,
	]);
});

test('filterIslands keeps triangles that share an edge as one island', () => {
	const result = filterIslands(new Uint32Array([0, 1, 2, 2, 1, 3]), 2);

	assert.equal(result.islandCount, 1);
	assert.equal(result.keptIslands, 1);
	assert.equal(result.removedTriangles, 0);
	assert.deepEqual(Array.from(result.indices), [0, 1, 2, 2, 1, 3]);
});

test('filterIslands keeps everything when the threshold is 1', () => {
	const result = filterIslands(new Uint32Array([0, 1, 2, 5, 6, 7]), 1);

	assert.equal(result.removedTriangles, 0);
	assert.equal(result.islandCount, 2);
	assert.equal(result.keptIslands, 2);
	assert.deepEqual(Array.from(result.indices), [0, 1, 2, 5, 6, 7]);
});

test('filterIslands ignores empty index buffers', () => {
	const result = filterIslands(new Uint32Array(0), 50);

	assert.equal(result.triangleCount, 0);
	assert.equal(result.islandCount, 0);
	assert.equal(result.removedTriangles, 0);
	assert.equal(result.indices.length, 0);
});

// obj.ts input routing. The obj2gltf call is loaded lazily inside loadObjDocument, so simply
// importing obj.ts here never pulls the converter.

test('isGltfPath and isObjPath match extensions case-insensitively', () => {
	assert.equal(isGltfPath('scan.glb'), true);
	assert.equal(isGltfPath('scan.GLTF'), true);
	assert.equal(isGltfPath('scan.obj'), false);
	assert.equal(isGltfPath('scan'), false);

	assert.equal(isObjPath('scan.obj'), true);
	assert.equal(isObjPath('matterpak/scan.OBJ'), true);
	assert.equal(isObjPath('scan.glb'), false);
	assert.equal(isObjPath('scan.objx'), false);
});

test('classifyInput routes glTF and OBJ inputs and rejects everything else', () => {
	assert.equal(classifyInput('scan.glb'), 'gltf');
	assert.equal(classifyInput('scan.gltf'), 'gltf');
	assert.equal(classifyInput('scan.obj'), 'obj');
	assert.equal(classifyInput('MatterPak/scan.OBJ'), 'obj');

	assert.equal(classifyInput('scan.ply'), null);
	assert.equal(classifyInput('scan.e57'), null);
	assert.equal(classifyInput('scan'), null);
});

test('objUpHint recommends --up z for OBJ inputs unless --up was given', () => {
	assert.equal(objUpHint(true), null);
	assert.equal(objUpHint(false), OBJ_UP_HINT);
	assert.match(objUpHint(false) ?? '', /--up z/);
});
