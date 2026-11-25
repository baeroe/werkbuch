/*
 * The line a person reads stays in place while lines come in above it (WEBU-37). jsdom lays nothing out: every element
 * stands where `layout` says, the list at 100 px, its lines 40 px each, moved up by what is scrolled.
 */

import { act, render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { placeOf, scrollerOf, useReadingPlace } from './useReadingPlace';

const LIST_TOP = 100;
const LINE = 40;

/** What the page (or the panel) has scrolled. */
let scrolled = 0;
const original = HTMLElement.prototype.getBoundingClientRect;

const rect = (top: number, height: number) => ({ x: 0, y: top, top, left: 0, right: 0, bottom: top + height, width: 0, height, toJSON: () => ({}) }) as DOMRect;

beforeEach(() => {
  scrolled = 0;
  HTMLElement.prototype.getBoundingClientRect = function layout(this: HTMLElement) {
    if (this.dataset.scroller !== undefined) return rect(0, 600);
    if (this.tagName === 'OL') return rect(LIST_TOP - scrolled, this.children.length * LINE);
    if (this.tagName === 'LI') return rect(LIST_TOP + Array.from(this.parentElement!.children).indexOf(this) * LINE - scrolled, LINE);
    return rect(0, 0);
  };
});

afterEach(() => {
  HTMLElement.prototype.getBoundingClientRect = original;
  vi.restoreAllMocks();
});

function Lines({ lines }: { lines: string[] }) {
  const list = useRef<HTMLOListElement>(null);
  useReadingPlace(list);
  return (
    <ol ref={list}>
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ol>
  );
}

/** A panel's `scrollTop` is `scrolled`. */
function scrollsBy(panel: HTMLDivElement | null): void {
  if (!panel) return;
  Object.defineProperty(panel, 'scrollTop', {
    configurable: true,
    get: () => scrolled,
    set: (value: number) => {
      scrolled = value;
    },
  });
}

/** The lines in a panel that scrolls (the preview); `scrolled` is its `scrollTop`. */
function Panel({ lines }: { lines: string[] }) {
  return (
    <div data-scroller="" style={{ overflowY: 'auto' }} ref={scrollsBy}>
      <Lines lines={lines} />
    </div>
  );
}

const lines = (...names: string[]) => names;

describe('useReadingPlace', () => {
  it('finds the panel the list scrolls in, else the page', () => {
    const { container } = render(<Panel lines={lines('a')} />);
    expect(scrollerOf(container.querySelector('ol')!)).toBe(container.querySelector('[data-scroller]'));
    const page = render(<Lines lines={lines('a')} />);
    expect(scrollerOf(page.container.querySelector('ol')!)).toBeNull();
    const scrolling = document.createElement('div');
    scrolling.style.overflowY = 'scroll';
    const inner = scrolling.appendChild(document.createElement('ol'));
    expect(scrollerOf(inner)).toBe(scrolling);
  });

  it('knows no place while the start of the list is in sight, nor when every line is above', () => {
    const { container } = render(<Lines lines={lines('a', 'b', 'c')} />);
    const list = container.querySelector('ol')!;
    expect(placeOf(list)).toBeNull();
    scrolled = 150;
    expect(placeOf(list)).toEqual({ line: list.children[1], top: -10 });
    scrolled = 1000;
    expect(placeOf(list)).toBeNull();
  });

  it('keeps the line read in the panel in place when lines come in on top', () => {
    const view = render(<Panel lines={lines('c', 'b', 'a')} />);
    // reading further down: the scroll notes the line in sight
    scrolled = 150;
    act(() => void view.container.querySelector('[data-scroller]')!.dispatchEvent(new Event('scroll')));
    view.rerender(<Panel lines={lines('e', 'd', 'c', 'b', 'a')} />);
    // two lines came in above "b": the panel moves on by them, "b" stands where it stood
    expect(scrolled).toBe(150 + 2 * LINE);
    // a line above goes: the panel moves back by it
    view.rerender(<Panel lines={lines('d', 'c', 'b', 'a')} />);
    expect(scrolled).toBe(150 + LINE);
  });

  it('lets a new line show on top while the start is in sight', () => {
    const view = render(<Panel lines={lines('b', 'a')} />);
    view.rerender(<Panel lines={lines('c', 'b', 'a')} />);
    expect(scrolled).toBe(0);
  });

  it('moves the page when the list scrolls with it, and stops listening when it goes', () => {
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
    const view = render(<Lines lines={lines('b', 'a')} />);
    scrolled = 120;
    act(() => void window.dispatchEvent(new Event('resize')));
    view.rerender(<Lines lines={lines('c', 'b', 'a')} />);
    expect(scrollBy).toHaveBeenCalledWith(0, LINE);
    // nothing moved above the place: the page stays
    scrollBy.mockClear();
    view.rerender(<Lines lines={lines('c', 'b', 'a', 'z')} />);
    expect(scrollBy).not.toHaveBeenCalled();

    const remove = vi.spyOn(window, 'removeEventListener');
    view.unmount();
    expect(remove.mock.calls.map(([type]) => type)).toEqual(expect.arrayContaining(['scroll', 'resize']));
  });
});
