import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProjectBadge, projectTone } from './ProjectBadge';

describe('projectTone', () => {
  it('gives the same identifier always the same tone, and the demo projects their moodboard tones', () => {
    expect(projectTone('WEB')).toBe('sky');
    expect(projectTone('APP')).toBe('moss');
    expect(projectTone('OPS')).toBe('ochre');
    expect(projectTone('WEB')).toBe(projectTone('WEB'));
  });
});

describe('ProjectBadge', () => {
  it('shows the first letter of the identifier on its tone, decorative', () => {
    const { container } = render(<ProjectBadge project={{ identifier: 'WEB', image_url: null }} />);

    const badge = container.firstElementChild!;
    expect(badge.textContent).toBe('W');
    expect(badge.getAttribute('data-tone')).toBe('sky');
    expect(badge.getAttribute('aria-hidden')).toBe('true');
    expect(badge.className).toContain('size-5');
  });

  it('is larger as md and takes a class', () => {
    const { container } = render(<ProjectBadge project={{ identifier: 'APP', image_url: null }} size="md" className="mr-2" />);

    expect(container.firstElementChild?.className).toContain('size-8');
    expect(container.firstElementChild?.className).toContain('mr-2');
  });

  it('shows the project image instead of the letter, decorative', () => {
    const { container } = render(<ProjectBadge project={{ identifier: 'OPS', image_url: 'https://example.com/ops.png' }} />);

    const image = container.querySelector('img')!;
    expect(image.getAttribute('src')).toBe('https://example.com/ops.png');
    expect(image.getAttribute('alt')).toBe('');
    expect(image.getAttribute('aria-hidden')).toBe('true');
    expect(screen.queryByText('O')).toBeNull();
  });
});
