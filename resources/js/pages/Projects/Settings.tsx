import { ProjectSettings } from '@/features/settings/project/ProjectSettings';
import { shellLayout } from '@/shell/layout';

/** `/projects/{identifier}/settings/{section}`: the settings of a project, General without a section. */
export default function Settings({ identifier, section }: { identifier: string; section: string }) {
  return <ProjectSettings identifier={identifier} section={section} />;
}

Settings.layout = shellLayout;
