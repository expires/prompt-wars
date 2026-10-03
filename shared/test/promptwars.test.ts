import { describe, expect, it } from 'vitest';
import { censorText, containsProfanity, normalizePrompt } from '../src';

describe('normalizePrompt', () => {
  it('lowercases, trims, folds punctuation and whitespace', () => {
    expect(normalizePrompt('  A Baguette,   that fires ANGRY bees!! ')).toBe('a baguette that fires angry bees');
    expect(normalizePrompt('a baguette that fires angry bees')).toBe(normalizePrompt('A baguette -- that fires angry bees.'));
    expect(normalizePrompt('rubber-duck_war hammer')).toBe('rubber duck war hammer');
  });
  it('keeps non-latin letters and digits', () => {
    expect(normalizePrompt('Miecz ŻÓŁWIA 3000')).toBe('miecz żółwia 3000');
  });
  it('empty / punctuation only -> empty', () => {
    expect(normalizePrompt('  ?!  ')).toBe('');
  });
  it('is capped', () => {
    expect(normalizePrompt('x '.repeat(500)).length).toBeLessThanOrEqual(200);
  });
});

describe('profanity filter', () => {
  it('censors whole words with asterisks, same length', () => {
    expect(censorText('fuck this gun')).toBe('**** this gun');
    expect(censorText('Shitty Rifle')).toBe('****** Rifle');
    expect(censorText('a bitch-slap glove')).toBe('a *****-slap glove');
  });
  it('folds leetspeak, repeats and polish diacritics', () => {
    expect(containsProfanity('sh1t')).toBe(true);
    expect(containsProfanity('f@ggot')).toBe(true);
    expect(containsProfanity('fuuuuck')).toBe(true);
    expect(containsProfanity('kurwa mać')).toBe(true);
    expect(containsProfanity('ja pierdolę')).toBe(true);
    expect(containsProfanity('spierdalaj')).toBe(true);
    expect(containsProfanity('zajebisty miecz')).toBe(true);
    expect(containsProfanity('CHUJOWY')).toBe(true);
    // spaced-out letters are not words (accepted miss)
    expect(censorText('k u r w a')).toBe('k u r w a');
  });
  it('leaves innocent words alone (Scunthorpe)', () => {
    for (const ok of [
      'Scunthorpe United', 'assassin blade', 'cocktail shaker', 'class act', 'grape launcher', 'bass cannon',
      'Dickens novel', 'pass the ball', 'cockpit laser', 'shuttlecock', 'niggle', 'whorl', 'Fukushima', 'hello', 'analysis',
      'therapist', 'fagot (bassoon)', 'pedał roweru', 'sukces', 'kurtka', 'chustka', 'jabłko', 'shiitake', 'Matsuda',
    ]) expect(containsProfanity(ok), ok).toBe(false);
  });
  it('is length-preserving with emoji / surrogates', () => {
    expect(censorText('🔥 fuck 🔥')).toBe('🔥 **** 🔥');
  });
});
