/*
 * The open page of the wiki (ported from the clickdummy's PageView.tsx): the page on its sheet (`PageSheet`) once the
 * page and the rights are there, the skeleton until then.
 * - A page the server did not find for the person (`pageFound: false`, A322) is never asked for: "Diese Seite gibt es
 *   nicht". A page that answers 404 or 403 reads the same; another failure is the error with retry.
 * - A page known to be deleted (live, a save that met a 404, an own delete: `usePageGone`) is not asked for again:
 *   "Diese Seite wurde gelöscht", and text typed into it that the server does not hold stays above that, read-only,
 *   with "Kopieren" and "Verwerfen" (A318, like A154).
 * A page of another project cannot arrive here: the server sends such an address to the page's own wiki (A322).
 */

import { Link } from '@inertiajs/react';
import { FileQuestionMark } from 'lucide-react';
import { useRef } from 'react';
import { ApiError } from '@/api/client';
import { Banner } from '@/components/ui/Banner';
import { Button, buttonClass } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { isEmptyDoc } from '@/editor/RichTextEditor';
import { RichTextView } from '@/editor/RichTextView';
import { CopyButton } from '@/features/settings/tokens/CopyButton';
import { usePage } from '@/hooks/pages';
import { drafts, pageDraft, usePageDraft } from '@/lib/drafts';
import { t } from '@/lib/i18n';
import { usePageGone } from '@/lib/liveGone';
import { paths } from '@/lib/links';
import { docToText } from '@/lib/richtext';
import type { PageNode } from '@/types';
import { SHEET } from './format';
import { PageSheet } from './PageSheet';

export interface PageViewProps {
  projectId: string;
  identifier: string;
  pageId: string;
  /** Whether the server found the page for the person. */
  pageFound: boolean;
  /** The pages above it in the tree, the top one first. */
  ancestors: readonly PageNode[];
  /** Whether the rights are known, and why the person may not edit (null: they may). */
  rights: { ready: boolean; denied: string | null };
  /** A page just made: its title takes the focus, selected. */
  focusTitle?: boolean;
  onMove?: () => void;
  onDelete?: () => void;
  onCreateChild?: () => void;
}

function PageSkeleton() {
  return (
    <SkeletonGroup label={t('wiki.page.loading')} className={SHEET}>
      <Skeleton className="h-3 w-40" />
      <div className="mt-6 flex items-center gap-3">
        <Skeleton className="size-11 rounded-ctl" />
        <Skeleton className="h-8 w-2/3" />
      </div>
      <Skeleton className="mt-3 h-3 w-56" />
      <div className="mt-8 flex flex-col gap-3">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-4/5" />
      </div>
    </SkeletonGroup>
  );
}

/** A page the wiki cannot show: it does not exist for the person, or it was deleted meanwhile. */
function PageGone({ identifier, deleted }: { identifier: string; deleted: boolean }) {
  return (
    <EmptyState
      icon={FileQuestionMark}
      titleAs="h1"
      title={deleted ? t('wiki.page.deleted.title') : t('wiki.page.missing.title')}
      description={deleted ? t('wiki.page.deleted.description') : t('wiki.page.missing.description')}
      actions={
        <Link href={paths.wiki(identifier)} className={buttonClass({ variant: 'secondary' })}>
          {t('wiki.page.to_overview')}
        </Link>
      }
      className="max-w-[52rem]"
    />
  );
}

/** A page deleted meanwhile, with what was typed into it and not saved, to copy. */
function PageDeleted({ identifier, pageId }: { identifier: string; pageId: string }) {
  const key = pageDraft(pageId);
  const unsaved = usePageDraft(key);
  const parked = useRef<HTMLDivElement>(null);
  return (
    <div className="flex max-w-[52rem] flex-col gap-4">
      {unsaved && (
        <Banner tone="danger" role="alert" title={t('wiki.page.deleted.unsaved')}>
          <div ref={parked} className="mt-2 rounded-md border border-line bg-surface p-3">
            <p className="font-display font-bold text-ink">{unsaved.title}</p>
            {unsaved.content && !isEmptyDoc(unsaved.content) && <RichTextView value={unsaved.content} preset="page" className="mt-1" />}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <CopyButton text={[unsaved.title, docToText(unsaved.content)].filter(Boolean).join('\n\n')} target={() => parked.current} size="sm" />
            <Button variant="secondary" size="sm" onClick={() => drafts.setPage(key, null)}>
              {t('wiki.page.deleted.discard')}
            </Button>
          </div>
        </Banner>
      )}
      <PageGone identifier={identifier} deleted />
    </div>
  );
}

export function PageView(props: PageViewProps) {
  const { identifier, pageId, pageFound } = props;
  const gone = usePageGone(pageId);
  const query = usePage(pageFound ? pageId : null);

  if (!pageFound) return <PageGone identifier={identifier} deleted={false} />;
  if (gone) return <PageDeleted identifier={identifier} pageId={pageId} />;
  if (query.isError && !query.data) {
    if (query.error instanceof ApiError && (query.error.status === 404 || query.error.status === 403)) return <PageGone identifier={identifier} deleted={false} />;
    return (
      <ErrorState
        title={t('wiki.page.failed')}
        description={query.error.message || t('errors.no_answer')}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
        className="max-w-[52rem]"
      />
    );
  }
  if (!query.data || !props.rights.ready) return <PageSkeleton />;
  return <PageSheet {...props} page={query.data} />;
}
