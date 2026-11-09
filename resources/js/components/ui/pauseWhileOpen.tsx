import type { ComponentPropsWithRef, ReactElement } from 'react';
import { useDialogScope } from '@/lib/shortcuts/useShortcut';

function PausePageShortcuts() {
  useDialogScope();
  return null;
}

/**
 * Render function for the popup of a dialog or popover (`render={pauseWhileOpen}`): while it is open, only `dialog`
 * shortcuts and the global mod+k, escape and mod+enter run, the page's shortcuts pause. Tied to the open state, not to
 * the mount: a popup stays in the DOM while it animates out, and the page's keys work again from the moment it closes
 * (⌘Z right after a confirmed delete).
 */
export function pauseWhileOpen(props: ComponentPropsWithRef<'div'>, state: { open: boolean }): ReactElement {
  return (
    <div {...props}>
      {state.open && <PausePageShortcuts />}
      {props.children}
    </div>
  );
}
