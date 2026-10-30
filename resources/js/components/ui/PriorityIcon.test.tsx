import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import en from '../../../../lang/en.json';
import { initI18n } from '@/lib/i18n';
import type { Priority } from '@/types';
import { PRIORITY_LABELS, PriorityIcon } from './PriorityIcon';

const FILLED: [Exclude<Priority, 'urgent'>, number][] = [
  ['high', 3],
  ['medium', 2],
  ['low', 1],
  ['none', 0],
];

describe('PriorityIcon', () => {
  it('has the display names of the spec', () => {
    expect(PRIORITY_LABELS).toEqual({ urgent: 'Urgent', high: 'High', medium: 'Medium', low: 'Low', none: 'None' });
  });

  it('draws urgent as a red square with an exclamation mark', () => {
    render(<PriorityIcon priority="urgent" />);

    const icon = screen.getByRole('img', { name: 'Priorität Urgent' });
    expect(icon.textContent).toBe('!');
    expect(icon.className).toContain('bg-danger');
  });

  it.each(FILLED)('draws %s with %i of three strokes filled', (priority, filled) => {
    render(<PriorityIcon priority={priority} className="ml-1" />);

    const icon = screen.getByRole('img', { name: `Priorität ${PRIORITY_LABELS[priority]}` });
    const strokes = [...icon.children];
    expect(strokes).toHaveLength(3);
    expect(strokes.filter((stroke) => stroke.className.includes('bg-muted'))).toHaveLength(filled);
    expect(strokes.filter((stroke) => stroke.className.includes('bg-line-strong'))).toHaveLength(3 - filled);
    expect(icon.className).toContain('ml-1');
  });

  it('names every priority in the language of the page', () => {
    initI18n({ locale: 'en', translations: en });

    for (const priority of Object.keys(PRIORITY_LABELS) as Priority[]) {
      const { unmount } = render(<PriorityIcon priority={priority} />);
      expect(screen.getByRole('img', { name: `Priority ${PRIORITY_LABELS[priority]}` })).toBeTruthy();
      unmount();
    }
  });
});
