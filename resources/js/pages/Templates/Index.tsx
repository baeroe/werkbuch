import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { t } from '@/lib/i18n';
import { shellLayout } from '@/shell/layout';

interface Props {
  identifier: string;
  /** `new`, the ULID of a template or any other text as it came; null for the list. */
  templateId: string | null;
}

/**
 * `/projects/{identifier}/templates/{templateId?}`: the templates of a project. Until the templates screen comes (task
 * 15 of phase 10) the page is its frame: the heading and a skeleton.
 */
export default function Index(_props: Props) {
  return (
    <div className="max-w-5xl">
      <h1 data-screen-heading tabIndex={-1} className="font-display text-lg font-bold tracking-title text-ink">
        {t('shell.nav.project_templates')}
      </h1>
      <SkeletonGroup className="mt-4 flex flex-col gap-1">
        {[0, 1, 2].map((row) => (
          <div key={row} className="flex items-center gap-3 px-2 py-2">
            <Skeleton className="size-8 rounded-ctl" />
            <Skeleton className="h-3.5 w-1/3" />
          </div>
        ))}
      </SkeletonGroup>
    </div>
  );
}

Index.layout = shellLayout;
