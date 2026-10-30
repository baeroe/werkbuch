import { ErrorLayout } from '@/shell/layout';
import { ErrorPage } from '@/shell/PageStates';

export default function ErrorScreen({ status }: { status: 403 | 500 | 503 }) {
  return <ErrorPage status={status} />;
}

ErrorScreen.layout = ErrorLayout;
