/*
 * The create dialog (`c`, spec 5.2) while `useUiStore.createOpen` is set. Its code is loaded on the first open and
 * then stays mounted, so the dialog can animate out; `CreateItemDialog` (Task 8) gets the defaults of `openCreate`.
 */

import { lazy, Suspense, useState } from 'react';
import { useUiStore } from '@/store/ui';

const CreateItemDialog = lazy(() => import('@/features/create-item/CreateItemDialog').then((module) => ({ default: module.CreateItemDialog })));

export function CreateHost() {
  const open = useUiStore((state) => state.createOpen);
  const defaults = useUiStore((state) => state.createDefaults);
  const [used, setUsed] = useState(open);
  if (open && !used) setUsed(true);
  if (!used) return null;

  return (
    <Suspense fallback={null}>
      <CreateItemDialog
        open={open}
        defaults={defaults}
        onOpenChange={(next) => {
          if (!next) useUiStore.getState().closeCreate();
        }}
      />
    </Suspense>
  );
}
