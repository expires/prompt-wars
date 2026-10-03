import { describe, expect, it } from 'vitest';
import type { ForgeEvent } from '@ai-gaem/shared/forge';
import { DesignAssembler } from '../src/assembler';

function run(prompt: string, lines: Record<string, unknown>[]) {
  const events: ForgeEvent[] = [];
  const asm = new DesignAssembler({ variant: 0, locked: [], rejected: [], prompt }, e => events.push(e));
  for (const l of lines) asm.push(l);
  const design = asm.finish();
  return { design, events, asm };
}

describe('assembler readability pass', () => {
  it('expands macros, clamps a katana blade curve and seats a floating blade', () => {
    const { design, events } = run('katana', [
      { t: 'meta', name: 'Test Blade', class: 'melee', fireMode: 'melee', palette: { primary: '#111111', secondary: '#121212', accent: '#ffcc00', glow: '#ffffff' } },
      { t: 'component', id: 'tsuka', label: 'tsuka', role: 'handle', shapes: [{ type: 'bevelbox', size: [0.03, 0.034, 0.27], material: { color: 'secondary' } }] },
      { t: 'component', id: 'blade', label: 'blade', role: 'blade', parent: 'tsuka', attach: 'front', transform: { pos: [0, 0.2, -0.3] }, shapes: [{ type: 'blade', length: 0.7, width: 0.032, curve: 0.3, material: { color: 'primary', metalness: 1 } }] },
      { t: 'stats', damage: 50, fireRate: 1.2, melee: { swing: 'slash', weight: 'medium' } },
    ]);
    const blade = design.components.find(c => c.id === 'blade')!;
    expect(blade.shapes![0].type).toBe('extrude');
    const ys = (blade.shapes![0] as { outline: [number, number][] }).outline.map(p => p[1]);
    // curve 0.035 -> tip rises < 2.5 cm over 70 cm
    expect(Math.max(...ys)).toBeLessThan(0.04);
    // streamed component already seated (no 0.3 m jump at "done")
    const streamed = events.find(e => e.type === 'component' && e.component.id === 'blade') as Extract<ForgeEvent, { type: 'component' }>;
    expect(Math.abs(streamed.component.transform.pos[1])).toBeLessThan(0.02);
    // palette lifted out of the mud
    const meta = events.find(e => e.type === 'meta') as Extract<ForgeEvent, { type: 'meta' }>;
    expect(meta.palette.primary).not.toBe('#111111');
  });
});
