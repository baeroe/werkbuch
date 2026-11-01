/*
 * The empty list "Zugewiesen" of Meine Items: nothing open is assigned to the person. The way to the projects and "Neues
 * Item" (the create dialog); without the right to create in any project the button stays and says why.
 */

import { Link } from '@inertiajs/react';
import { List, SquarePen } from 'lucide-react';
import { Button, buttonClass } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { t } from '@/lib/i18n';
import { paths } from '@/lib/links';
import { usePermissions } from '@/lib/permissions';
import { SHORTCUTS } from '@/lib/shortcuts/catalog';
import { useUiStore } from '@/store/ui';

export function MyItemsEmpty() {
  const { reason } = usePermissions();
  return (
    <EmptyState
      icon={List}
      title={t('items.empty.my.title')}
      description={t('items.empty.my.description')}
      actions={
        <>
          <Link href={paths.projects()} className={buttonClass({ variant: 'secondary' })}>
            {t('items.empty.projects_link')}
          </Link>
          <Button
            variant="primary"
            icon={SquarePen}
            shortcut={SHORTCUTS['item.create'].keys}
            disabledReason={reason('item.create')}
            onClick={() => useUiStore.getState().openCreate()}
          >
            {t('commands.create.label')}
          </Button>
        </>
      }
    />
  );
}
