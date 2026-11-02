/*
 * Unsaved changes of a list (spec 4.11), ported from the clickdummy: when the filter or the display differ from the
 * saved view (on a built-in list: the filter, P28), a bar offers "Verwerfen", "Als neue View …" and, for a view,
 * "Speichern".
 *
 * - "Speichern" changes the view for the whole team: only its creator and org admins may (`view.manage_any`); everybody
 *   else sees the button with the reason and saves a copy instead.
 * - "Als neue View …": anybody with an org role (spec: "Alle können eine View als neue View speichern").
 */

import { Bookmark, Save, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { t } from '@/lib/i18n';
import type { View } from '@/types';

type UnsavedBarProps = {
  /** The saved view of a view list; built-in lists have none. */
  view?: View;
  /** Why "Speichern" is not allowed (not the creator, no org admin), or null. */
  saveReason: string | null;
  /** Why "Als neue View" is not possible here, or null. */
  saveAsReason: string | null;
  saving: boolean;
  onDiscard(): void;
  onSave(): void;
  onSaveAs(): void;
};

export function UnsavedBar({ view, saveReason, saveAsReason, saving, onDiscard, onSave, onSaveAs }: UnsavedBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-ctl bg-sunken px-3 py-1.5">
      <p className="flex min-w-0 items-center gap-2 text-sm text-ink">
        <span className="size-2 shrink-0 rounded-full bg-accent" aria-hidden="true" />
        <span className="min-w-0 text-pretty">
          <span className="font-semibold">{t('items.save.unsaved')}</span>
          <span className="text-muted"> {view ? t('items.save.unsaved_view', { name: view.name }) : t('items.save.unsaved_list')}</span>
        </span>
      </p>
      <div className="ml-auto flex flex-wrap items-center gap-1.5">
        <Button variant="ghost" size="sm" icon={Undo2} onClick={onDiscard}>
          {t('items.save.discard')}
        </Button>
        <Button variant="secondary" size="sm" icon={Bookmark} disabledReason={saveAsReason} onClick={onSaveAs}>
          {t('items.save.save_as')}
        </Button>
        {view && (
          <Button variant="primary" size="sm" icon={Save} pending={saving} disabledReason={saveReason} onClick={onSave}>
            {t('items.save.save')}
          </Button>
        )}
      </div>
    </div>
  );
}
