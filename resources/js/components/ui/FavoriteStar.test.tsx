import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import en from '../../../../lang/en.json';
import { initI18n } from '@/lib/i18n';
import { FavoriteStar } from './FavoriteStar';

describe('FavoriteStar', () => {
  it('offers to put the item into the sidebar while it is not in it', () => {
    render(<FavoriteStar active={false} pending={false} name="Roadmap" onToggle={() => {}} />);

    const button = screen.getByRole('button', { name: '„Roadmap“ in die Seitenleiste legen' });
    expect(button.querySelector('svg.lucide-star')).not.toBeNull();
    expect(button.className).not.toContain('fill-current');
  });

  it('offers to take it out again while it is in it, with a filled star', () => {
    render(<FavoriteStar active pending={false} name="Roadmap" onToggle={() => {}} />);

    const button = screen.getByRole('button', { name: '„Roadmap“ aus der Seitenleiste nehmen' });
    expect(button.className).toContain('[&>svg]:fill-current');
  });

  it('speaks the language of the page', () => {
    initI18n({ locale: 'en', translations: en });
    const { rerender } = render(<FavoriteStar active={false} pending={false} name="Roadmap" onToggle={() => {}} />);
    expect(screen.getByRole('button', { name: 'Add “Roadmap” to the sidebar' })).toBeTruthy();

    rerender(<FavoriteStar active pending={false} name="Roadmap" onToggle={() => {}} />);
    expect(screen.getByRole('button', { name: 'Remove “Roadmap” from the sidebar' })).toBeTruthy();
  });

  it('calls onToggle on a press', async () => {
    const onToggle = vi.fn();
    render(<FavoriteStar active={false} pending={false} name="Roadmap" onToggle={onToggle} />);

    await userEvent.click(screen.getByRole('button'));

    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('shows a spinner with aria-busy while pending, and ignores a second press', async () => {
    const onToggle = vi.fn();
    render(<FavoriteStar active pending name="Roadmap" onToggle={onToggle} />);

    const button = screen.getByRole('button');
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.querySelector('svg.lucide-loader-circle')).not.toBeNull();
    expect(button.querySelector('svg.lucide-star')).toBeNull();
    expect(button.className).toContain('[&>svg]:animate-spin');
    expect(button.className).not.toContain('fill-current');

    await userEvent.click(button);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('cannot be pressed while it is disabled, the state not being known yet', async () => {
    const onToggle = vi.fn();
    render(<FavoriteStar active={false} pending={false} name="Roadmap" onToggle={onToggle} disabled />);

    const button = screen.getByRole('button', { name: '„Roadmap“ in die Seitenleiste legen' });
    expect(button).toHaveProperty('disabled', true);
    await userEvent.click(button);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('is not busy when it is not pending', () => {
    render(<FavoriteStar active={false} pending={false} name="Roadmap" onToggle={() => {}} />);

    expect(screen.getByRole('button').hasAttribute('aria-busy')).toBe(false);
  });
});
