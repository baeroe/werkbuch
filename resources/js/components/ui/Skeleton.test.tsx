import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../../../../lang/en.json';
import { initI18n } from '@/lib/i18n';
import { Skeleton, SkeletonGroup } from './Skeleton';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** The moment after which a skeleton shows. */
const late = () => act(() => vi.advanceTimersByTime(300));

describe('Skeleton', () => {
  it('is a silent block that takes a class', () => {
    const { container } = render(<Skeleton className="h-4 w-24" />);

    const block = container.firstElementChild!;
    expect(block.getAttribute('aria-hidden')).toBe('true');
    expect(block.className).toContain('h-4 w-24');
  });

  it('keeps its place but shows only after 300 ms on its own', () => {
    const { container } = render(<Skeleton className="h-4 w-24" />);
    const block = container.firstElementChild!;
    expect(block.className).toContain('invisible');

    act(() => vi.advanceTimersByTime(299));
    expect(block.className).toContain('invisible');
    act(() => vi.advanceTimersByTime(1));
    expect(block.className).not.toContain('invisible');
  });
});

describe('SkeletonGroup', () => {
  it('shows no skeleton before 300 ms', () => {
    const { container } = render(
      <SkeletonGroup label="Items laden" className="space-y-2">
        <Skeleton className="h-4" />
      </SkeletonGroup>,
    );

    // the place is held, nothing shows and nothing is said
    const group = container.firstElementChild!;
    expect(group.className).toContain('invisible');
    expect(group.getAttribute('aria-hidden')).toBe('true');
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText('Items laden')).toBe(group.firstElementChild);

    act(() => vi.advanceTimersByTime(299));
    expect(screen.queryByRole('status')).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('status')).toBe(group);
    expect(group.className).not.toContain('invisible');
    // the skeletons inside show with the group, not after a moment of their own
    expect(group.querySelector('.invisible')).toBeNull();
  });

  it('is a status with its label as text, around its skeletons, and not permanently busy', () => {
    render(
      <SkeletonGroup label="Items laden" className="space-y-2">
        <Skeleton className="h-4" />
      </SkeletonGroup>,
    );
    late();

    const group = screen.getByRole('status');
    // aria-busy on a live region can suppress the one-time announcement
    expect(group.hasAttribute('aria-busy')).toBe(false);
    expect(group.hasAttribute('aria-hidden')).toBe(false);
    expect(group.textContent).toBe('Items laden');
    expect(group.className).toContain('space-y-2');
    expect(group.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it('keeps its skeletons in place when it shows (no new elements)', () => {
    const { container } = render(
      <SkeletonGroup>
        <Skeleton className="h-4" />
      </SkeletonGroup>,
    );
    const block = container.querySelector('.h-4');
    late();
    expect(container.querySelector('.h-4')).toBe(block);
  });

  it('is a span inside a line of text', () => {
    const { container } = render(
      <p>
        <SkeletonGroup as="span" className="inline-block w-14">
          <Skeleton className="h-3.5" />
        </SkeletonGroup>
      </p>,
    );
    late();
    expect(screen.getByRole('status').tagName).toBe('SPAN');
    expect(container.querySelector('p > span')).toBe(screen.getByRole('status'));
  });

  it('says it is loading in the language of the page when it has no label', () => {
    const { unmount } = render(<SkeletonGroup>{null}</SkeletonGroup>);
    late();
    expect(screen.getByRole('status').textContent).toBe('Lädt …');
    unmount();

    initI18n({ locale: 'en', translations: en });
    render(<SkeletonGroup>{null}</SkeletonGroup>);
    late();
    expect(screen.getByRole('status').textContent).toBe('Loading …');
  });
});
