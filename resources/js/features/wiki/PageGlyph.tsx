/*
 * A page's emoji, or a page glyph when it has none (ported from the clickdummy's MovePageDialog.tsx); decorative, the
 * title names the page.
 */

import { FileText } from 'lucide-react';

export function PageGlyph({ emoji, className = 'text-base' }: { emoji: string | null; className?: string }) {
  return emoji ? (
    <span aria-hidden="true" className={className}>
      {emoji}
    </span>
  ) : (
    <FileText className="size-4 text-muted" aria-hidden="true" />
  );
}
