import { ViewsScreen } from '@/features/views/ViewsScreen';
import { shellLayout } from '@/shell/layout';

/** `/views`: every team view; `?create=1` opens the dialog "New view" once (`create`). */
export default function Index({ create }: { create: boolean }) {
  return <ViewsScreen create={create} />;
}

Index.layout = shellLayout;
