import { cleanup, configure } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';
import de from '../../../lang/de.json';
import { initI18n } from '@/lib/i18n';

// Vitest runs without globals, so Testing Library cannot register its own cleanup.
afterEach(() => cleanup());

// The tests speak German, like the clickdummy they come from; a test that needs another language calls initI18n itself.
// Before each test, so one that switched the language does not leak it into the next.
beforeEach(() => initI18n({ locale: 'de', translations: de }));

// The preview and the editor are split into lazy chunks; on a busy CI runner their first import takes longer than
// Testing Library's default second, so `findBy…` and `waitFor` wait up to five.
configure({ asyncUtilTimeout: 5000 });
