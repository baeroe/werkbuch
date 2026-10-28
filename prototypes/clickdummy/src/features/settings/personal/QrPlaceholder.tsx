/*
 * The QR dummy of the two-factor setup, drawn as an SVG from `qrModules`. It stays ink on white in both themes, like a
 * real code would, and says what it is.
 */

import { useMemo } from 'react';
import { cx } from '@/components/ui/cx';
import { qrModules } from './qr';

const QUIET_ZONE = 2;

export function QrPlaceholder({ seed, className }: { seed: string; className?: string }) {
  const modules = useMemo(() => qrModules(seed), [seed]);
  const size = modules.length;

  // one rectangle per run of dark modules in a row
  const path = useMemo(() => {
    const runs: string[] = [];
    modules.forEach((row, y) => {
      let x = 0;
      while (x < size) {
        if (!row[x]) {
          x += 1;
          continue;
        }
        const start = x;
        while (x < size && row[x]) x += 1;
        runs.push(`M${start} ${y}h${x - start}v1h${start - x}z`);
      }
    });
    return runs.join('');
  }, [modules, size]);

  const edge = size + QUIET_ZONE * 2;
  return (
    <svg
      role="img"
      aria-label="QR-Code-Attrappe"
      viewBox={`${-QUIET_ZONE} ${-QUIET_ZONE} ${edge} ${edge}`}
      shapeRendering="crispEdges"
      className={cx('size-40 shrink-0 rounded-chip border border-line-strong', className)}
    >
      <rect x={-QUIET_ZONE} y={-QUIET_ZONE} width={edge} height={edge} fill="var(--day-surface)" />
      <path d={path} fill="var(--day-text)" />
    </svg>
  );
}
