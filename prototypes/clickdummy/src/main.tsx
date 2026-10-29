import '@fontsource-variable/bricolage-grotesque/opsz.css';
import '@fontsource-variable/figtree';
import './styles/app.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app/App';

// Import only modules that export components here: an edit to a module with other exports would otherwise re-run
// this entry during hot reload and call createRoot twice.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
