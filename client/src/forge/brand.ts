// Shared header title for the Forge / Closet editors (with the first-login step above it).
import { esc } from '../ui/dom';

export function brandText(title: string, step?: string): string {
  if (!step) return `<span>${esc(title)}</span>`;
  return `<span class="forge-brand-text"><span class="forge-step" data-testid="flow-step">${esc(step)}</span><span>${esc(title)}</span></span>`;
}
