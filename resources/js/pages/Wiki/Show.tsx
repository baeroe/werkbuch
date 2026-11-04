import { shellLayout } from '@/shell/layout';

interface Props {
  identifier: string;
  pageId: string | null;
  pageFound: boolean;
}

/**
 * `/projects/{identifier}/wiki/{pageId?}`: the wiki of a project and one of its pages. A placeholder until the wiki
 * screen comes (Task 13 renders `WikiScreen({ identifier, pageId, pageFound })` here).
 */
export default function Show({ identifier, pageId }: Props) {
  return (
    <div className="p-6">
      <h1 translate="no">{identifier}</h1>
      {pageId !== null && <p translate="no">{pageId}</p>}
    </div>
  );
}

Show.layout = shellLayout;
