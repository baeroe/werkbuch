import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Glued, splitFirst } from './glued';

describe('splitFirst', () => {
  it('takes the first character off a text', () => {
    expect(splitFirst('Rahmenvertrag Betrieb & Support')).toEqual(['R', 'ahmenvertrag Betrieb & Support']);
    expect(splitFirst('A')).toEqual(['A', '']);
    expect(splitFirst('')).toEqual(['', '']);
  });

  it('keeps a character with its modifiers whole', () => {
    expect(splitFirst('👍🏽 gut')).toEqual(['👍🏽', ' gut']);
    expect(splitFirst('étude')).toEqual(['é', 'tude']);
  });
});

describe('Glued', () => {
  it('keeps the glyph with the first character and leaves the rest free', () => {
    const { container } = render(
      <p>
        <Glued glyph={<span data-testid="glyph">🧭</span>} text="Rahmenvertrag Betrieb & Support: Konditionen" />
      </p>,
    );
    const glued = container.querySelector('.rt-glued');
    expect(glued?.textContent).toBe('🧭R');
    expect(glued?.firstElementChild?.getAttribute('data-testid')).toBe('glyph');
    // the text reads as before: no character added
    expect(container.textContent).toBe('🧭Rahmenvertrag Betrieb & Support: Konditionen');
  });
});
