import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { TypeTone } from '@/types';
import { Chip, ToneDot } from './Chip';

const TONES: TypeTone[] = ['sky', 'ochre', 'moss', 'plum', 'sand', 'slate'];

describe('ToneDot', () => {
  it.each(TONES)('draws the %s dot, decorative', (tone) => {
    const { container } = render(<ToneDot tone={tone} className="ml-1" />);

    const dot = container.firstElementChild!;
    expect(dot.className).toContain(`bg-${tone}`);
    expect(dot.className).toContain('ml-1');
    expect(dot.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('Chip', () => {
  it('shows its text', () => {
    const { container } = render(<Chip>In Arbeit</Chip>);

    expect(container.textContent).toBe('In Arbeit');
    expect(container.querySelector('button')).toBeNull();
    expect((container.firstElementChild as HTMLElement).className).toContain('h-6');
  });

  it.each(TONES)('shows a %s dot before the text', (tone) => {
    const { container } = render(<Chip dot={tone}>Label</Chip>);

    expect(container.querySelector(`.bg-${tone}`)).not.toBeNull();
  });

  it('shows its icon, hidden from screen readers', () => {
    const { container } = render(<Chip icon={<svg data-testid="icon" />}>Hoch</Chip>);

    expect(screen.getByTestId('icon').parentElement?.getAttribute('aria-hidden')).toBe('true');
    expect(container.textContent).toBe('Hoch');
  });

  it('shows a remove button with its own name that calls onRemove', async () => {
    const onRemove = vi.fn();
    const { container } = render(
      <Chip onRemove={onRemove} removeLabel="Label Backend entfernen" className="ml-2">
        Backend
      </Chip>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Label Backend entfernen' }));

    expect(onRemove).toHaveBeenCalledOnce();
    expect((container.firstElementChild as HTMLElement).className).toContain('h-11');
    expect((container.firstElementChild as HTMLElement).className).toContain('ml-2');
  });
});
