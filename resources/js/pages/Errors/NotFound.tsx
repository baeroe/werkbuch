import { ErrorLayout } from '@/shell/layout';
import { NotFound } from '@/shell/PageStates';

export default function NotFoundPage() {
  return <NotFound />;
}

NotFoundPage.layout = ErrorLayout;
