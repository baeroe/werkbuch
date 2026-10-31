import { ProjectsScreen } from '@/features/projects/ProjectsScreen';
import { shellLayout } from '@/shell/layout';

/** `/projects`: every project the person sees; `?create=1` opens the dialog "New project" once (`create`). */
export default function Index({ create }: { create: boolean }) {
  return <ProjectsScreen create={create} />;
}

Index.layout = shellLayout;
