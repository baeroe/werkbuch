import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { StateCategory, StateIcon } from '@/types';
import { StatusIcon } from './StatusIcon';

const ICONS: StateIcon[] = ['dashed', 'circle', 'half', 'three-quarter', 'pause', 'check', 'cross'];
const CATEGORIES: StateCategory[] = ['backlog', 'unstarted', 'started', 'completed', 'canceled'];

/** What each shape draws: [circles, paths, lines]. */
const SHAPES: Record<StateIcon, [number, number, number]> = {
  dashed: [0, 8, 0],
  circle: [1, 0, 0],
  half: [1, 1, 0],
  'three-quarter': [1, 1, 0],
  pause: [1, 0, 2],
  check: [1, 1, 0],
  cross: [1, 2, 0],
};

describe('StatusIcon', () => {
  for (const icon of ICONS) {
    for (const category of CATEGORIES) {
      it(`draws the ${icon} shape in the colour of ${category}, named by its label`, () => {
        render(<StatusIcon icon={icon} category={category} label={`Status ${icon}`} />);

        const svg = screen.getByRole('img', { name: `Status ${icon}` });
        expect(svg.getAttribute('class')).toContain(`text-st-${category}`);
        const [circles, paths, lines] = SHAPES[icon];
        expect([svg.querySelectorAll('circle').length, svg.querySelectorAll('path').length, svg.querySelectorAll('line').length]).toEqual([circles, paths, lines]);
      });
    }
  }

  it('is 16 px, takes a class and the props of an svg, and can be hidden next to visible text', () => {
    render(<StatusIcon icon="check" category="completed" label="Erledigt" className="ml-1" aria-hidden="true" />);

    const svg = document.querySelector('svg')!;
    expect(svg.getAttribute('class')).toContain('size-4');
    expect(svg.getAttribute('class')).toContain('ml-1');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(screen.queryByRole('img', { name: 'Erledigt' })).toBeNull();
  });
});
