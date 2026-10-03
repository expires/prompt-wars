import { PARTS } from '../src/registry';
import { countTris } from '../src/lib/kit';
const by: Record<string, number> = {};
let worst: [string, number][] = [];
const ids = new Set<string>();
for (const p of PARTS) {
  if (ids.has(p.id)) console.log('DUP', p.id);
  ids.add(p.id);
  by[p.category] = (by[p.category] ?? 0) + 1;
  try {
    const o = p.build({});
    const t = countTris(o);
    worst.push([p.id, t]);
    let meshes = 0; o.traverse((x: any) => { if (x.isMesh) { meshes++; const a = x.geometry.attributes.position.array; for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) { console.log('NaN', p.id); break; } } });
  } catch (e) { console.log('ERR', p.id, (e as Error).message); }
}
worst.sort((a, b) => b[1] - a[1]);
console.log(by, 'total', PARTS.length);
console.log('worst', worst.slice(0, 25));
console.log('over500', worst.filter((w) => w[1] > 500).length, worst.filter((w) => w[1] > 500).map((w) => w.join(':')).join(' '));
