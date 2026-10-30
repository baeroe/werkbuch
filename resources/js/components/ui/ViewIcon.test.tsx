import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { VIEW_ICONS, ViewIcon } from './ViewIcon';

describe('ViewIcon', () => {
  it('draws a Lucide icon by name, decorative', () => {
    const { container } = render(<ViewIcon icon="inbox" className="text-muted" />);

    const svg = container.querySelector('svg.lucide-inbox')!;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('class')).toContain('text-muted');
  });

  it('knows the type icons and the extra view icons', () => {
    expect(Object.keys(VIEW_ICONS)).toEqual(expect.arrayContaining(['bug', 'layers', 'inbox', 'bot', 'timer']));
  });

  it('shows an emoji somebody chose as text', () => {
    const { container } = render(<ViewIcon icon="🚀" />);

    expect(container.querySelector('svg')).toBeNull();
    expect(container.firstElementChild?.textContent).toBe('🚀');
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
  });

  it('falls back to the standard icon for an unknown name', () => {
    const { container } = render(<ViewIcon icon="gibt-es-nicht" />);

    expect(container.querySelector('svg.lucide-layers')).not.toBeNull();
  });
});
