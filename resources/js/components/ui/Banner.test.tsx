import { render, screen } from '@testing-library/react';
import { Archive } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { Banner } from './Banner';

describe('Banner', () => {
  it('is neutral by default with the info icon', () => {
    const { container } = render(<Banner title="Blockiert von WEB-3" />);

    expect(screen.getByText('Blockiert von WEB-3')).toBeTruthy();
    expect((container.firstElementChild as HTMLElement).className).toContain('bg-sunken');
    expect(container.querySelector('svg.lucide-info')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('colours the info tone', () => {
    const { container } = render(<Banner tone="info" title="Live-Updates pausiert" />);

    expect((container.firstElementChild as HTMLElement).className).toContain('bg-accent-soft');
    expect(container.querySelector('svg.lucide-info')).not.toBeNull();
  });

  it('colours the danger tone and gives it the alert icon', () => {
    const { container } = render(<Banner tone="danger" title="Bearbeitungskonflikt" />);

    expect((container.firstElementChild as HTMLElement).className).toContain('bg-danger-soft');
    expect(container.querySelector('svg.lucide-circle-alert')).not.toBeNull();
  });

  it('takes another icon, a body, an action and the props of a div', () => {
    const { container } = render(
      <Banner icon={Archive} title="Archiviert" action={<button type="button">Wiederherstellen</button>} role="status" className="mb-3">
        Das Item ist schreibgeschützt.
      </Banner>,
    );

    const banner = screen.getByRole('status');
    expect(banner.className).toContain('mb-3');
    expect(container.querySelector('svg.lucide-archive')).not.toBeNull();
    expect(banner.textContent).toContain('Das Item ist schreibgeschützt.');
    expect(screen.getByRole('button', { name: 'Wiederherstellen' })).toBeTruthy();
  });

  it('has no body or action element without children and action', () => {
    const { container } = render(<Banner title="Nur Titel" />);

    expect(container.querySelectorAll('p')).toHaveLength(1);
    expect(container.querySelector('.self-center')).toBeNull();
  });
});
