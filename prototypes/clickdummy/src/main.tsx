import '@fontsource-variable/bricolage-grotesque/opsz.css';
import '@fontsource-variable/figtree';
import './styles/app.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { Toaster } from '@/components/ui/Toaster';
import { TooltipProvider } from '@/components/ui/Tooltip';
import { ComponentsGallery } from '@/routes/components-gallery';
import { Start } from '@/routes/start';

// Minimal router until Task 4 brings src/app/router.tsx; then this file only mounts <App />.
// Import only modules that export components here: an edit to a module with other exports would otherwise
// re-run this entry during hot reload and call createRoot twice.
const router = createBrowserRouter([
  { path: '/', element: <Start /> },
  { path: '/_components', element: <ComponentsGallery /> },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TooltipProvider>
      <RouterProvider router={router} />
      <Toaster />
    </TooltipProvider>
  </StrictMode>,
);
