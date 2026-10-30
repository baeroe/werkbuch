import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// Vitest runs without globals, so Testing Library cannot register its own cleanup.
afterEach(() => cleanup());

// The preview and the editor are split into lazy chunks; on a busy CI runner their first import takes longer than
// Testing Library's default second, so `findBy…` and `waitFor` wait up to five.
configure({ asyncUtilTimeout: 5000 });
