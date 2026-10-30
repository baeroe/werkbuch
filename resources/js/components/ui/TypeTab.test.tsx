import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { TypeTone } from '@/types';
import { TYPE_ICONS, TypeTab, typeIcon } from './TypeTab';

describe('TypeTab', () => {
  it.each(['sky', 'ochre', 'moss', 'plum', 'sand', 'slate'] satisfies TypeTone[])('carries the %s tone', (tone) => {
    const { container } = render(<TypeTab tone={tone} icon="bug" label="WEB-1" />);

    expect(container.firstElementChild?.getAttribute('data-tone')).toBe(tone);
  });

  it('shows the icon by its Lucide name beside the text, and does not translate the label', () => {
    const { container } = render(<TypeTab tone="sky" icon="bug" label="WEB-12" />);

    expect(container.querySelector('svg.lucide-bug')?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByText('WEB-12')).toBeTruthy();
    expect(container.firstElementChild?.getAttribute('translate')).toBe('no');
  });

  it('falls back to the task icon for an unknown name', () => {
    const { container } = render(<TypeTab tone="sky" icon="gibt-es-nicht" label="WEB-12" />);

    expect(container.querySelector('svg.lucide-square-check')).not.toBeNull();
  });

  it('is 24 px high by default and 20 px as sm, and takes a class', () => {
    const { container } = render(
      <>
        <TypeTab tone="sky" icon="bug" label="A" />
        <TypeTab tone="sky" icon="bug" label="B" size="sm" className="shrink-0" />
      </>,
    );

    const [md, sm] = [...container.children] as HTMLElement[];
    expect(md.className).toContain('h-6');
    expect(sm.className).toContain('h-5');
    expect(sm.className).toContain('shrink-0');
  });

  it('knows every type icon by name', () => {
    for (const name of Object.keys(TYPE_ICONS)) {
      expect(typeIcon(name), name).toBe(TYPE_ICONS[name as keyof typeof TYPE_ICONS]);
    }
    expect(typeIcon('nope')).toBe(TYPE_ICONS['square-check']);
  });
});
