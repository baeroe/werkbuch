import { WikiScreen } from '@/features/wiki/WikiScreen';
import { shellLayout } from '@/shell/layout';

interface Props {
  identifier: string;
  pageId: string | null;
  /** Whether the server found the page for the person; false without a page as well. */
  pageFound: boolean;
}

/** `/projects/{identifier}/wiki/{pageId?}`: the wiki of a project and one of its pages. */
export default function Show({ identifier, pageId, pageFound }: Props) {
  return <WikiScreen identifier={identifier} pageId={pageId} pageFound={pageFound} />;
}

Show.layout = shellLayout;
