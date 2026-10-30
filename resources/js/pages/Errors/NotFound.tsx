import { t } from '@/lib/i18n';

// Placeholder: Task 12 replaces the page.
export default function NotFound() {
  return (
    <main id="main" className="min-h-screen bg-paper text-ink">
      <h1>{t('errors.page.not_found.title')}</h1>
    </main>
  );
}
