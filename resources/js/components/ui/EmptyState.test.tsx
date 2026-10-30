import { render, screen } from '@testing-library/react';
import { Check, Inbox } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('shows its icon and title, the title as a paragraph by default', () => {
    const { container } = render(<EmptyState icon={Inbox} title="Nichts im Posteingang" />);

    expect(screen.getByText('Nichts im Posteingang').tagName).toBe('P');
    expect(container.querySelector('svg.lucide-inbox')).not.toBeNull();
    expect(container.querySelector('svg.lucide-check')).toBeNull();
    expect(container.querySelectorAll('p')).toHaveLength(1);
  });

  it.each(['h1', 'h2'] as const)('sets the title as %s when it is the whole page', (tag) => {
    render(<EmptyState icon={Inbox} title="Seite nicht gefunden" titleAs={tag} />);

    expect(screen.getByRole('heading', { name: 'Seite nicht gefunden', level: Number(tag[1]) })).toBeTruthy();
  });

  it('shows a badge, a description and actions', () => {
    const { container } = render(
      <EmptyState
        icon={Inbox}
        badge={Check}
        title="Alles erledigt"
        description="Hier landen neue Meldungen."
        actions={<button type="button">Zur Übersicht</button>}
        className="mt-8"
      />,
    );

    expect(container.querySelector('svg.lucide-check')).not.toBeNull();
    expect(screen.getByText('Hier landen neue Meldungen.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Zur Übersicht' })).toBeTruthy();
    expect((container.firstElementChild as HTMLElement).className).toContain('mt-8');
  });
});
