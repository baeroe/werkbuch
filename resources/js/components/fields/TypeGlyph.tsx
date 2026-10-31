import { typeIcon } from '@/components/ui/TypeTab';
import type { WorkItemType } from '@/types';

/**
 * A type's icon in the ink of its tone, as the tab of its cards shows it. In the clickdummy it lives in `TypePicker`;
 * the parent list and the type picker both show it, so it stands on its own.
 */
export function TypeGlyph({ type, className = 'size-4' }: { type: Pick<WorkItemType, 'icon' | 'tone'>; className?: string }) {
  const Icon = typeIcon(type.icon);
  return (
    <span data-tone={type.tone} aria-hidden="true" className="inline-flex shrink-0 text-[var(--tab-ink)]">
      <Icon className={className} />
    </span>
  );
}
