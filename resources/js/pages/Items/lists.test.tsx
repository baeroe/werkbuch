import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { shellLayout } from '@/shell/layout';
import ProjectItems from '../Projects/Show';
import ViewItems from '../Views/Show';
import Created from './Created';
import MyItems from './MyItems';
import Subscribed from './Subscribed';

// The pages of the item lists only hand their list to the items screen (features/items/screen.test.tsx tests it).

vi.mock('@/features/items/ItemsScreen', () => ({
  ItemsScreen: (props: Record<string, string>) => <p>{JSON.stringify(props)}</p>,
}));

describe('item list pages', () => {
  it.each([
    ['Meine Items', <MyItems key="my" />, { preset: 'my' }],
    ['Erstellt', <Created key="created" />, { preset: 'created' }],
    ['Beobachtet', <Subscribed key="subscribed" />, { preset: 'subscribed' }],
    ['a project', <ProjectItems key="project" identifier="WEB" />, { preset: 'project', projectIdentifier: 'WEB' }],
    ['a view', <ViewItems key="view" viewId="v_1" />, { preset: 'view', viewId: 'v_1' }],
  ])('render the items screen of %s', (_name, page, props) => {
    render(page);
    expect(JSON.parse(screen.getByRole('paragraph').textContent!)).toEqual(props);
  });

  it('live in the shell', () => {
    for (const page of [MyItems, Created, Subscribed, ProjectItems, ViewItems]) expect(page.layout).toBe(shellLayout);
  });
});
