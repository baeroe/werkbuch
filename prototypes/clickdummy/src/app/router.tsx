/*
 * All routes (plan, Task 4). Every screen is loaded on demand (`React.lazy`), each from the one file its task owns:
 * a later task replaces the placeholder there and the route stays as it is. "/" leads to /my-items; an unknown route
 * shows the 404 page inside the shell. The screens before signing in and the component gallery stand without it.
 */

import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate, Outlet, ScrollRestoration } from 'react-router';
import { NotFound, RouteError } from './PageStates';
import { Shell } from './Shell';

const Gallery = lazy(() => import('@/routes/components-gallery').then((module) => ({ default: module.ComponentsGallery })));
const Login = lazy(() => import('@/features/auth/Login'));
const Invitation = lazy(() => import('@/features/auth/Invitation'));
const ForgotPassword = lazy(() => import('@/features/auth/ForgotPassword'));
const Items = lazy(() => import('@/features/items/routes'));
const Inbox = lazy(() => import('@/features/inbox'));
const ViewsOverview = lazy(() => import('@/features/views-overview'));
const Projects = lazy(() => import('@/features/projects'));
const ItemPage = lazy(() => import('@/features/item-detail/ItemPage').then((module) => ({ default: module.ItemPage })));
const Wiki = lazy(() => import('@/features/wiki'));
const Templates = lazy(() => import('@/features/templates'));
const ProjectSettings = lazy(() => import('@/features/settings/project'));
const OrgSettings = lazy(() => import('@/features/settings/org'));
const PersonalSettings = lazy(() => import('@/features/settings/personal'));

/**
 * The root of all routes: Back and Forward restore the scroll position; the screens without the shell show nothing
 * while their code loads (a fraction of a second).
 */
function Root() {
  return (
    <>
      <ScrollRestoration />
      <Suspense fallback={null}>
        <Outlet />
      </Suspense>
    </>
  );
}

function StandaloneError() {
  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <RouteError />
    </main>
  );
}

export const router = createBrowserRouter([
  {
    element: <Root />,
    errorElement: <StandaloneError />,
    children: [
      { path: '_components', element: <Gallery /> },
      { path: 'login', element: <Login /> },
      { path: 'invitations/:token', element: <Invitation /> },
      { path: 'forgot-password', element: <ForgotPassword /> },
      {
        element: <Shell />,
        children: [
          {
            // a screen that crashes shows its error inside the shell, the sidebar stays
            errorElement: <RouteError />,
            children: [
              { index: true, element: <Navigate to="/my-items" replace /> },
              { path: 'my-items', element: <Items preset="my" /> },
              { path: 'created', element: <Items preset="created" /> },
              { path: 'subscribed', element: <Items preset="subscribed" /> },
              { path: 'inbox', element: <Inbox /> },
              { path: 'views', element: <ViewsOverview /> },
              { path: 'views/:viewId', element: <Items preset="view" /> },
              { path: 'projects', element: <Projects /> },
              { path: 'projects/:identifier', element: <Items preset="project" /> },
              { path: 'projects/:identifier/wiki/:pageId?', element: <Wiki /> },
              { path: 'projects/:identifier/templates/:templateId?', element: <Templates /> },
              { path: 'projects/:identifier/settings/:section?', element: <ProjectSettings /> },
              { path: 'items/:key', element: <ItemPage /> },
              { path: 'settings/:section?', element: <OrgSettings /> },
              { path: 'me/:section?', element: <PersonalSettings /> },
              { path: '*', element: <NotFound /> },
            ],
          },
        ],
      },
    ],
  },
]);
