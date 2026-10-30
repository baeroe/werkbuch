import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { IndexCard } from './IndexCard';

describe('IndexCard', () => {
  it('is an article with its content, its tone and a tab with the icon and the label', () => {
    const { container } = render(
      <IndexCard tone="moss" icon="bug" tabLabel="WEB-7">
        Login hängt
      </IndexCard>,
    );

    const card = screen.getByRole('article');
    expect(card.getAttribute('data-tone')).toBe('moss');
    expect(card.textContent).toContain('Login hängt');
    expect(card.querySelector('[data-tab-row]')?.textContent).toBe('WEB-7');
    expect(container.querySelector('svg.lucide-bug')).not.toBeNull();
  });

  it('is plain by default: not selected, not lifted, not inert', () => {
    render(
      <IndexCard tone="sky" icon="bug" tabLabel="WEB-7">
        Inhalt
      </IndexCard>,
    );

    const card = screen.getByRole('article');
    expect(card.hasAttribute('data-selected')).toBe(false);
    expect(card.hasAttribute('data-lifted')).toBe(false);
    expect(card.hasAttribute('inert')).toBe(false);
    expect(card.className).toContain('shadow-elev-1');
  });

  it('has a stronger edge and elevation when selected', () => {
    render(
      <IndexCard tone="sky" icon="bug" tabLabel="WEB-7" selected>
        Inhalt
      </IndexCard>,
    );

    const card = screen.getByRole('article');
    expect(card.getAttribute('data-selected')).toBe('true');
    expect(card.className).toContain('shadow-elev-2');
    expect(card.className).toContain('border-line-strong');
  });

  it('is lifted and inert while it is dragged', () => {
    render(
      <IndexCard tone="sky" icon="bug" tabLabel="WEB-7" lifted>
        Inhalt
      </IndexCard>,
    );

    const card = screen.getByRole('article', { hidden: true });
    expect(card.getAttribute('data-lifted')).toBe('true');
    expect(card.hasAttribute('inert')).toBe(true);
    expect(card.className).toContain('-rotate-2');
  });

  it('puts a prefix before the tab and passes the props of an article on', () => {
    render(
      <IndexCard tone="sky" icon="bug" tabLabel="WEB-7" tabPrefix={<span>WEB-1 /</span>} className="w-64" aria-label="Karte">
        Inhalt
      </IndexCard>,
    );

    const row = document.querySelector('[data-tab-row]')!;
    expect(row.firstElementChild?.textContent).toBe('WEB-1 /');
    expect(row.lastElementChild?.textContent).toBe('WEB-7');
    expect(screen.getByRole('article', { name: 'Karte' }).className).toContain('w-64');
  });
});
