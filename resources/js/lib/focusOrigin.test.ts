import { afterEach, describe, expect, it } from 'vitest';
import { useUiStore } from '@/store/ui';
import { createReturnFocus, focusBackTo, focusOriginNow } from './focusOrigin';

/** A button on the page, focused. */
function focused(name: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.textContent = name;
  document.body.append(button);
  button.focus();
  return button;
}

afterEach(() => {
  document.body.replaceChildren();
  useUiStore.setState(useUiStore.getInitialState());
});

describe('focusOrigin', () => {
  it('names the focused element, or the one before the palette while the palette is open', () => {
    const trigger = focused('Liste');
    expect(focusOriginNow()).toBe(trigger);

    useUiStore.getState().openPalette();
    focused('Palette');
    expect(focusOriginNow()).toBe(trigger);
  });

  it('gives the focus back to the origin while it is on the page, else to the focus origin, else to main', () => {
    const main = document.createElement('main');
    main.id = 'main';
    document.body.append(main);
    const trigger = focused('Liste');
    expect(focusBackTo(trigger)).toBe(trigger);
    expect(focusBackTo(document.body)).toBe(main);

    trigger.remove();
    expect(focusBackTo(trigger)).toBe(main);
    const heading = document.createElement('h1');
    heading.setAttribute('data-focus-origin', '');
    document.body.append(heading);
    expect(focusBackTo(null)).toBe(heading);
  });

  it('takes the origin of the create dialog when it is asked for, before the palette when it came from there', () => {
    const trigger = focused('Liste');
    useUiStore.getState().openPalette();
    const field = focused('Palette');
    // "Neues Item" runs while the palette is open, which closes after it
    useUiStore.getState().openCreate();
    useUiStore.getState().setPaletteOpen(false);
    field.remove();
    expect(createReturnFocus.current).toBe(trigger);

    useUiStore.getState().closeCreate();
    const button = focused('Neues Item');
    useUiStore.getState().openCreate();
    expect(createReturnFocus.current).toBe(button);
  });
});
