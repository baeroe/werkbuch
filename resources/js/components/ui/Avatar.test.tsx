import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Avatar, UnassignedAvatar } from './Avatar';

describe('Avatar', () => {
  it('gives the same name always the same tone', () => {
    const { container } = render(
      <>
        <Avatar user={{ name: 'Mara Lindqvist', type: 'person' }} />
        <Avatar user={{ name: 'Mara Lindqvist', type: 'person' }} />
      </>,
    );

    const [first, second] = [...container.children];
    expect(first.getAttribute('data-tone')).toBeTruthy();
    expect(first.getAttribute('data-tone')).toBe(second.getAttribute('data-tone'));
  });

  it('takes the initials of the first two words, and of a single word its first letter', () => {
    render(
      <>
        <Avatar user={{ name: 'mara anna lindqvist', type: 'person' }} />
        <Avatar user={{ name: 'Kira', type: 'person' }} />
      </>,
    );

    expect(screen.getByRole('img', { name: 'mara anna lindqvist' }).textContent).toBe('MA');
    expect(screen.getByRole('img', { name: 'Kira' }).textContent).toBe('K');
  });

  it('draws people round and bots square with the bot glyph, named as a bot', () => {
    render(
      <>
        <Avatar user={{ name: 'Mara Lindqvist', type: 'person' }} />
        <Avatar user={{ name: 'Kira', type: 'bot' }} />
      </>,
    );

    expect(screen.getByRole('img', { name: 'Mara Lindqvist' }).className).toContain('rounded-full');
    const bot = screen.getByRole('img', { name: 'Kira (Bot)' });
    expect(bot.className).toContain('rounded-chip');
    expect(bot.querySelector('svg.lucide-bot')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('comes in two sizes and takes a class', () => {
    render(
      <>
        <Avatar user={{ name: 'Mara Lindqvist', type: 'person' }} className="ml-1" />
        <Avatar user={{ name: 'Kira', type: 'bot' }} size="sm" />
      </>,
    );

    expect(screen.getByRole('img', { name: 'Mara Lindqvist' }).className).toContain('size-7');
    expect(screen.getByRole('img', { name: 'Mara Lindqvist' }).className).toContain('ml-1');
    expect(screen.getByRole('img', { name: 'Kira (Bot)' }).className).toContain('size-5');
  });

  it('stays silent next to a visible name when it is decorative', () => {
    const { container } = render(<Avatar user={{ name: 'Mara Lindqvist', type: 'person' }} decorative />);

    expect(screen.queryByRole('img')).toBeNull();
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
    expect(container.firstElementChild?.hasAttribute('aria-label')).toBe(false);
  });
});

describe('UnassignedAvatar', () => {
  it('is a dashed circle named "Nicht zugewiesen", in two sizes', () => {
    render(
      <>
        <UnassignedAvatar />
        <UnassignedAvatar size="md" className="ml-1" />
      </>,
    );

    const [small, medium] = screen.getAllByRole('img', { name: 'Nicht zugewiesen' });
    expect(small.className).toContain('border-dashed');
    expect(small.className).toContain('size-5');
    expect(medium.className).toContain('size-7');
    expect(medium.className).toContain('ml-1');
  });
});
