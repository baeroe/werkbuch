import { TemplatesScreen } from '@/features/templates/TemplatesScreen';
import { shellLayout } from '@/shell/layout';

interface Props {
  identifier: string;
  /** `new`, the ULID of a template or any other text as it came; null for the list. */
  templateId: string | null;
}

/** `/projects/{identifier}/templates/{templateId?}`: the templates of a project (`TemplatesScreen`). */
export default function Index({ identifier, templateId }: Props) {
  return <TemplatesScreen identifier={identifier} templateId={templateId} />;
}

Index.layout = shellLayout;
