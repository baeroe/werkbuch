/*
 * Placeholder until Task 7 replaces this file.
 *
 * Contract: the named export `TimelineLayout(props: LayoutProps)` (display/layouts.ts, which documents the props and
 * what a layout does). The registry loads this file on demand when the layout is "timeline" (`?layout=timeline`, key 4).
 */

import { ChartGantt } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import type { LayoutProps } from '../display/layouts';

export function TimelineLayout(_props: LayoutProps) {
  return (
    <EmptyState
      icon={ChartGantt}
      title="Kommt in Task 7"
      description="Hier entsteht die Timeline: die Epics der Projekte als Balken vom Start- bis zum Due-Date, mit Fortschritt und Zoom. Bis dahin zeigen Liste (1) und Tabelle (3) die Items."
    />
  );
}
