/**
 * Pure helpers for the offline map pipeline (client/scripts/map).
 *
 * No I/O and no @gltf-transform imports, so this module runs under `node --test` with
 * native type stripping. Matrices are column-major 4x4 (length 16), the layout used by
 * glTF, three.js and gl-matrix.
 */

export type Vec3 = [number, number, number];
export type Mat4 = number[];
export type UpAxis = 'y' | 'z';
export type Bounds = { min: Vec3; max: Vec3 };

export type IslandFilterResult = {
	/** Kept triangle indices, triangle-major. */
	indices: Uint32Array;
	/** Triangles left after filtering. */
	triangleCount: number;
	removedTriangles: number;
	/** Connected components found in the input. */
	islandCount: number;
	keptIslands: number;
};

export function identityMatrix(): Mat4 {
	return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/**
 * Rotation that brings a scan authored in `up` into Y-up. Z-up sources (Polycam,
 * Scaniverse, Matterport) are rotated -90deg about X: (x, y, z) -> (x, z, -y).
 */
export function axisMatrix(up: UpAxis): Mat4 {
	if (up === 'y') return identityMatrix();
	return [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1];
}

export function scaleMatrix(scale: number): Mat4 {
	return [scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, 1];
}

export function translationMatrix(offset: Vec3): Mat4 {
	const [x, y, z] = offset;
	return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
}

/** Column-major matrix product `a * b`: applies `b` first, then `a`. */
export function multiply(a: ArrayLike<number>, b: ArrayLike<number>): Mat4 {
	const out: Mat4 = new Array(16).fill(0);
	for (let column = 0; column < 4; column++) {
		for (let row = 0; row < 4; row++) {
			let sum = 0;
			for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[column * 4 + k];
			out[column * 4 + row] = sum;
		}
	}
	return out;
}

/** Transforms a point by an affine column-major matrix (w = 1). */
export function applyMatrix(matrix: ArrayLike<number>, point: Vec3): Vec3 {
	const [x, y, z] = point;
	return [
		matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
		matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
		matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
	];
}

export function emptyBounds(): Bounds {
	const inf = Number.POSITIVE_INFINITY;
	return { min: [inf, inf, inf], max: [-inf, -inf, -inf] };
}

export function isEmptyBounds(bounds: Bounds): boolean {
	return bounds.min[0] > bounds.max[0];
}

export function growBounds(bounds: Bounds, point: Vec3): void {
	const { min, max } = bounds;
	if (point[0] < min[0]) min[0] = point[0];
	if (point[1] < min[1]) min[1] = point[1];
	if (point[2] < min[2]) min[2] = point[2];
	if (point[0] > max[0]) max[0] = point[0];
	if (point[1] > max[1]) max[1] = point[1];
	if (point[2] > max[2]) max[2] = point[2];
}

export function boundsSize(bounds: Bounds): Vec3 {
	return [
		bounds.max[0] - bounds.min[0],
		bounds.max[1] - bounds.min[1],
		bounds.max[2] - bounds.min[2],
	];
}

/**
 * Translation that moves a bounding box so that min.y sits on the ground plane (y = 0)
 * and the XZ centre lands on the origin.
 */
export function recenterOffset(bounds: Bounds): Vec3 {
	const { min, max } = bounds;
	return [-(min[0] + max[0]) / 2, -min[1], -(min[2] + max[2]) / 2];
}

/**
 * Triangle count of a single primitive. `indices` may be null for non-indexed geometry.
 * Only TRIANGLES (mode 4) contributes; other primitive modes carry no trimesh meaning.
 */
export function countTriangles(
	indices: ArrayLike<number> | null | undefined,
	vertexCount: number,
	mode = 4,
): number {
	if (mode !== 4) return 0;
	const count = indices ? indices.length : vertexCount;
	return Math.floor(count / 3);
}

/**
 * Simplification ratio that takes `current` triangles down to `budget`, clamped to (0, 1].
 *
 * `budget / current` is positive whenever both inputs are, so `min(1, ...)` is the only clamp
 * needed: a scan already at or under budget simply keeps ratio 1 and skips simplification.
 * A degenerate count or budget also returns 1, so callers never hand meshoptimizer a NaN or
 * a zero ratio.
 */
export function simplifyRatio(current: number, budget: number): number {
	if (!(current > 0) || !(budget > 0)) return 1;
	return Math.min(1, budget / current);
}

/**
 * Drops triangles belonging to connected components ("islands") smaller than
 * `minIslandTriangles`. Components are vertex-connected, which for a welded mesh matches
 * edge-connected surfaces. `minIslandTriangles <= 1` keeps everything.
 */
export function filterIslands(indices: ArrayLike<number>, minIslandTriangles = 50): IslandFilterResult {
	const triangleCount = Math.floor(indices.length / 3);
	if (triangleCount === 0) {
		return {
			indices: new Uint32Array(0),
			triangleCount: 0,
			removedTriangles: 0,
			islandCount: 0,
			keptIslands: 0,
		};
	}

	let maxIndex = 0;
	for (let i = 0; i < triangleCount * 3; i++) {
		if (indices[i] > maxIndex) maxIndex = indices[i];
	}

	const parent = new Int32Array(maxIndex + 1);
	for (let i = 0; i < parent.length; i++) parent[i] = i;

	const find = (start: number): number => {
		let root = start;
		while (parent[root] !== root) root = parent[root];
		while (parent[start] !== root) {
			const next = parent[start];
			parent[start] = root;
			start = next;
		}
		return root;
	};

	const union = (a: number, b: number): void => {
		const rootA = find(a);
		const rootB = find(b);
		if (rootA !== rootB) parent[rootB] = rootA;
	};

	for (let t = 0; t < triangleCount; t++) {
		const a = indices[t * 3];
		const b = indices[t * 3 + 1];
		const c = indices[t * 3 + 2];
		union(a, b);
		union(b, c);
	}

	const perIsland = new Map<number, number>();
	for (let t = 0; t < triangleCount; t++) {
		const root = find(indices[t * 3]);
		perIsland.set(root, (perIsland.get(root) ?? 0) + 1);
	}

	let keptIslands = 0;
	for (const count of perIsland.values()) {
		if (count >= minIslandTriangles) keptIslands++;
	}

	const kept = new Uint32Array(triangleCount * 3);
	let write = 0;
	let removedTriangles = 0;
	for (let t = 0; t < triangleCount; t++) {
		const root = find(indices[t * 3]);
		if ((perIsland.get(root) ?? 0) >= minIslandTriangles) {
			kept[write++] = indices[t * 3];
			kept[write++] = indices[t * 3 + 1];
			kept[write++] = indices[t * 3 + 2];
		} else {
			removedTriangles++;
		}
	}

	return {
		indices: kept.slice(0, write),
		triangleCount: write / 3,
		removedTriangles,
		islandCount: perIsland.size,
		keptIslands,
	};
}
