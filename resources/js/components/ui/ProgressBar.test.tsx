import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import en from '../../../../lang/en.json';
import { initI18n } from '@/lib/i18n';
import { ProgressBar } from './ProgressBar';

describe('ProgressBar', () => {
  it('reads out the numbers and the percentage in German format', () => {
    render(<ProgressBar done={5} total={10} label="Kind-Items" />);

    const bar = screen.getByRole('progressbar', { name: 'Kind-Items' });
    // Intl puts a no-break space before the percent sign
    expect(bar.getAttribute('aria-valuetext')).toBe('5 von 10 fertig (50 %)');
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('10');
    expect(bar.getAttribute('aria-valuenow')).toBe('5');
    expect(bar.textContent).toBe('5/10');
  });

  it('reads out the percentage in British format in English', () => {
    initI18n({ locale: 'en', translations: en });
    render(<ProgressBar done={5} total={10} label="Child items" />);

    expect(screen.getByRole('progressbar').getAttribute('aria-valuetext')).toBe('5 of 10 done (50%)');
  });

  it('groups the thousands by the language', () => {
    render(<ProgressBar done={1200} total={2400} label="Kind-Items" />);

    expect(screen.getByRole('progressbar').getAttribute('aria-valuetext')).toBe('1.200 von 2.400 fertig (50 %)');
    expect(screen.getByRole('progressbar').textContent).toBe('1.200/2.400');
  });

  it('is empty at 0 and full at the total', () => {
    const { rerender } = render(<ProgressBar done={0} total={4} label="Kind-Items" />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuetext')).toBe('0 von 4 fertig (0 %)');
    expect(screen.getByRole('progressbar').textContent).toBe('0/4');

    rerender(<ProgressBar done={4} total={4} label="Kind-Items" />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuetext')).toBe('4 von 4 fertig (100 %)');
  });

  it('keeps the count within 0 and the total', () => {
    const { rerender } = render(<ProgressBar done={9} total={4} label="Kind-Items" />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('4');

    rerender(<ProgressBar done={-3} total={4} label="Kind-Items" />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0');
  });

  it('is 0 % and has no segments without parts', () => {
    const { container } = render(<ProgressBar done={0} total={0} label="Kind-Items" />);

    expect(screen.getByRole('progressbar').getAttribute('aria-valuetext')).toBe('0 von 0 fertig (0 %)');
    expect(container.querySelector('.grid')).toBeNull();
    expect((container.querySelector('[style]') as HTMLElement).style.width).toBe('0%');
  });

  it('draws one segment per part up to twelve, filled in the tone', () => {
    const { container } = render(<ProgressBar done={2} total={3} label="Kind-Items" tone="sky" className="mt-2" />);

    const segments = [...container.querySelectorAll('.grid > span')];
    expect(segments).toHaveLength(3);
    expect(segments.map((segment) => segment.className.includes('bg-sky'))).toEqual([true, true, false]);
    expect(segments[2].className).toContain('bg-line');
    expect(screen.getByRole('progressbar').className).toContain('mt-2');
  });

  it('draws a continuous bar above twelve parts', () => {
    const { container } = render(<ProgressBar done={13} total={26} label="Kind-Items" />);

    expect(container.querySelector('.grid')).toBeNull();
    const fill = container.querySelector('.bg-moss') as HTMLElement;
    expect(fill.style.width).toBe('50%');
  });
});
