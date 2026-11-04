/*
 * The head row of an open wiki page: the pages above it as links (the path, from the top), and on the right what acts
 * on the page (`children`: the save state, "Versionen …" and the menu `PageMenu`).
 */

import { Link } from '@inertiajs/react';
import { Ellipsis, FilePlus2, FolderInput, Trash2 } from 'lucide-react';
import { useRef, type ReactNode } from 'react';
import { IconButton } from '@/components/ui/IconButton';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/Menu';
import { t } from '@/lib/i18n';
import { SHORTCUTS } from '@/lib/shortcuts/catalog';
import { paths } from '@/lib/links';
import type { PageNode } from '@/types';

export function PageHeader({ identifier, ancestors, children }: { identifier: string; ancestors: readonly PageNode[]; children?: ReactNode }) {
  return (
    <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1">
      {ancestors.length > 0 && (
        <nav aria-label={t('wiki.page.path')} className="min-w-0">
          <ol className="flex min-w-0 flex-wrap items-center gap-x-1 text-sm text-muted">
            {ancestors.map((node) => (
              <li key={node.id} className="flex min-w-0 items-center gap-1">
                <Link
                  href={paths.wiki(identifier, node.id)}
                  className="inline-flex min-h-11 min-w-0 items-center gap-1 rounded-chip px-0.5 text-muted no-underline hover:text-ink hover:underline md:min-h-6"
                >
                  {node.emoji && <span aria-hidden="true">{node.emoji}</span>}
                  <span className="truncate">{node.title}</span>
                </Link>
                <span aria-hidden="true" className="text-faint">
                  /
                </span>
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div className="ml-auto flex min-w-0 items-center gap-1">{children}</div>
    </div>
  );
}

export interface PageMenuProps {
  onCreateChild: () => void;
  onMove: () => void;
  onDelete: () => void;
}

/**
 * What else acts on the page, for whoever may edit the wiki: "Unterseite anlegen", "Verschieben nach …" and
 * "Löschen …" (with the key of `wiki.delete`). An entry gives the focus to the menu's button before it acts, so the
 * dialog it opens gives it back there.
 */
export function PageMenu({ onCreateChild, onMove, onDelete }: PageMenuProps) {
  const trigger = useRef<HTMLButtonElement>(null);
  const act = (run: () => void) => () => {
    trigger.current?.focus();
    run();
  };
  return (
    <Menu>
      <MenuTrigger ref={trigger} render={<IconButton icon={Ellipsis} label={t('wiki.page.more')} tooltip={false} />} />
      <MenuContent align="end" className="w-60">
        <MenuItem icon={FilePlus2} onClick={act(onCreateChild)}>
          {t('wiki.child.command')}
        </MenuItem>
        <MenuItem icon={FolderInput} onClick={act(onMove)}>
          {t('wiki.move.menu')}
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={Trash2} danger shortcut={SHORTCUTS['wiki.delete'].keys} onClick={act(onDelete)}>
          {t('wiki.delete.menu')}
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
