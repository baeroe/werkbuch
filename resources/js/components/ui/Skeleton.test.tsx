import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import en from '../../../../lang/en.json';
import { initI18n } from '@/lib/i18n';
import { Skeleton, SkeletonGroup } from './Skeleton';

describe('Skeleton', () => {
  it('is a silent block that takes a class', () => {
    const { container } = render(<Skeleton className="h-4 w-24" />);

    const block = container.firstElementChild!;
    expect(block.getAttribute('aria-hidden')).toBe('true');
    expect(block.className).toContain('h-4 w-24');
  });
});

describe('SkeletonGroup', () => {
  it('is a busy status named by its label, around its skeletons', () => {
    render(
      <SkeletonGroup label="Items laden" className="space-y-2">
        <Skeleton className="h-4" />
      </SkeletonGroup>,
    );

    const group = screen.getByRole('status');
    expect(group.getAttribute('aria-busy')).toBe('true');
    expect(group.textContent).toBe('Items laden');
    expect(group.className).toContain('space-y-2');
    expect(group.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it('says it is loading in the language of the page when it has no label', () => {
    const { unmount } = render(<SkeletonGroup>{null}</SkeletonGroup>);
    expect(screen.getByRole('status').textContent).toBe('Lädt …');
    unmount();

    initI18n({ locale: 'en', translations: en });
    render(<SkeletonGroup>{null}</SkeletonGroup>);
    expect(screen.getByRole('status').textContent).toBe('Loading …');
  });
});
