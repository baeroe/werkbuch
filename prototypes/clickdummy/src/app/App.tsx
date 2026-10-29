/*
 * The app: the query client (the one that resets when the person changes), tooltips, the router with all screens and
 * the toasts above everything.
 */

import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router/dom';
import { Toaster } from '@/components/ui/Toaster';
import { TooltipProvider } from '@/components/ui/Tooltip';
import { queryClient } from '@/hooks/queryClient';
import { router } from './router';

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
