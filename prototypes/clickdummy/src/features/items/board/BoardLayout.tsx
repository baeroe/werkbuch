/*
 * Placeholder until Task 7 replaces this file.
 *
 * Contract: the named export `BoardLayout(props: LayoutProps)` (display/layouts.ts, which documents the props and what
 * a layout does). The registry loads this file on demand when the layout is "board" (`?layout=board`, key 2).
 */

import { SquareKanban } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import type { LayoutProps } from '../display/layouts';

export function BoardLayout({ items }: LayoutProps) {
  return (
    <EmptyState
      icon={SquareKanban}
      title="Kommt in Task 7"
      description={`Hier entsteht das Board für diese ${items.length} Items: Spalten nach der Gruppierung, Ziehen mit Prüfung der Übergänge und eine Schnellanlage je Spalte. Bis dahin zeigen Liste (1) und Tabelle (3) die Items.`}
    />
  );
}
