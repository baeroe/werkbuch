import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { registerShortcut } from '@/lib/shortcuts/registry';
import { SortableList } from './Sortable';

const ITEMS = [
  { id: 'a', name: 'Backlog' },
  { id: 'b', name: 'Todo' },
];

function renderList() {
  return render(
    <SortableList
      items={ITEMS}
      onReorder={() => {}}
      label="Status"
      nameOf={(item) => item.name}
      renderItem={(item, { handle }) => (
        <div>
          {handle}
          <span>{item.name}</span>
        </div>
      )}
    />,
  );
}

describe('SortableList handle', () => {
  it('lifts a row with the bare Space key, and leaves Ctrl+Enter to the page so the save shortcut still runs', async () => {
    const user = userEvent.setup();
    const save = vi.fn();
    const unregister = registerShortcut({ id: 'test.save', keys: 'mod+enter', scope: 'global', label: 'Speichern', group: 'Test', run: save });
    try {
      renderList();
      await user.tab();
      const handle = screen.getByRole('button', { name: 'Backlog verschieben' });
      expect(document.activeElement).toBe(handle);

      // Ctrl+Enter is the page's save: the handle must not take the key to lift the row
      await user.keyboard('{Control>}{Enter}{/Control}');
      expect(save).toHaveBeenCalledTimes(1);
      expect(handle.getAttribute('aria-pressed')).not.toBe('true');

      // Alt and Cmd belong to the system: no lift either
      await user.keyboard('{Alt>} {/Alt}');
      await user.keyboard('{Meta>}{Enter}{/Meta}');
      expect(handle.getAttribute('aria-pressed')).not.toBe('true');

      // the bare key still lifts the row
      await user.keyboard(' ');
      await waitFor(() => expect(handle.getAttribute('aria-pressed')).toBe('true'));
    } finally {
      unregister();
    }
  });
});
