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
	translationMatrix,
} from './lib.ts';
import type { Mat4, Vec3 } from './lib.ts';

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
