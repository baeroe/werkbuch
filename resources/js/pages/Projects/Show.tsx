import { ItemsScreen } from '@/features/items/ItemsScreen';
import { shellLayout } from '@/shell/layout';

/** `/projects/{identifier}`: the items of a project, by the identifier it has (a former one moved here with a 301). */
export default function Show({ identifier }: { identifier: string }) {
  return <ItemsScreen preset="project" projectIdentifier={identifier} />;
}

Show.layout = shellLayout;
