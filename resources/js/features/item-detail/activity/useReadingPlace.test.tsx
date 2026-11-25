/*
 * The line a person reads stays in place while things grow or go above it (WEBU-37). jsdom lays nothing out: every
 * element stands where `layout` says, the list at 100 px, its lines 40 px each (or what `heights` says), moved up by
 * what is scrolled. jsdom has no ResizeObserver: the tests bring one.
 */

import { act, render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { placeOf, scrollerOf, useReadingPlace } from './useReadingPlace';

const LIST_TOP = 100;
const LINE = 40;

/** What the page (or the panel) has scrolled. */
let scrolled = 0;
/** Heights of lines by their text (a run whose log unfolds); every other line is `LINE` high. */
let heights: Record<string, number> = {};
const original = HTMLElement.prototype.getBoundingClientRect;

const rect = (top: number, height: number) => ({ x: 0, y: top, top, left: 0, right: 0, bottom: top + height, width: 0, height, toJSON: () => ({}) }) as DOMRect;
const heightOf = (line: Element) => heights[line.textContent ?? ''] ?? LINE;

/** The observers the hook made: the test says when a watched box changed size. */
let observers: { callback: ResizeObserverCallback; targets: Element[]; on: boolean }[] = [];
const resized = (target: Element) =>
  act(() => observers.filter((entry) => entry.on && entry.targets.includes(target)).forEach((entry) => entry.callback([], {} as ResizeObserver)));

/** Frames run when the test says so. */
let frames: FrameRequestCallback[] = [];
const runFrames = () => act(() => frames.splice(0).forEach((frame) => frame(0)));

beforeEach(() => {
  scrolled = 0;
  heights = {};
  observers = [];
  frames = [];
  HTMLElement.prototype.getBoundingClientRect = function layout(this: HTMLElement) {
    if (this.dataset.scroller !== undefined) return rect(0, 600);
    if (this.tagName === 'OL') return rect(LIST_TOP - scrolled, Array.from(this.children).reduce((sum, line) => sum + heightOf(line), 0));
    if (this.tagName === 'LI') {
      const before = Array.from(this.parentElement!.children).slice(0, Array.from(this.parentElement!.children).indexOf(this));
      return rect(LIST_TOP + before.reduce((sum, line) => sum + heightOf(line), 0) - scrolled, heightOf(this));
    }
    return rect(0, 0);
  };
  vi.stubGlobal(
    'ResizeObserver',
    class {
      entry: (typeof observers)[number];
      constructor(callback: ResizeObserverCallback) {
        this.entry = { callback, targets: [], on: true };
        observers.push(this.entry);
      }
      observe(target: Element) {
        this.entry.targets.push(target);
      }
      disconnect() {
        this.entry.on = false;
      }
    },
  );
  vi.stubGlobal('requestAnimationFrame', (frame: FrameRequestCallback) => frames.push(frame));
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});

afterEach(() => {
  HTMLElement.prototype.getBoundingClientRect = original;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function Lines({ lines }: { lines: string[] }) {
  const list = useRef<HTMLOListElement>(null);
  useReadingPlace(list);
  if (lines.length === 0) return <p>Noch keine Aktivität.</p>;
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
      <div data-content="">
        <Lines lines={lines} />
      </div>
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
    expect(placeOf(list)).toEqual({ line: list.children[1], top: -10, scrolled: 0 });
    scrolled = 1000;
    expect(placeOf(list)).toBeNull();
  });

  it('turns the own anchoring of the browser off for the scroller while it watches, and back when it ends', () => {
    document.documentElement.style.setProperty('overflow-anchor', 'auto');
    const page = render(<Lines lines={lines('a')} />);
    expect(document.documentElement.style.getPropertyValue('overflow-anchor')).toBe('none');
    page.unmount();
    expect(document.documentElement.style.getPropertyValue('overflow-anchor')).toBe('auto');
    document.documentElement.style.removeProperty('overflow-anchor');

    const view = render(<Panel lines={lines('a')} />);
    const panel = view.container.querySelector<HTMLElement>('[data-scroller]')!;
    expect(panel.style.getPropertyValue('overflow-anchor')).toBe('none');
    view.rerender(<Panel lines={lines()} />);
    expect(panel.style.getPropertyValue('overflow-anchor')).toBe('');
  });

  it('keeps the line read in the panel in place when lines come in on top or go', () => {
    const view = render(<Panel lines={lines('c', 'b', 'a')} />);
    // reading further down: the scroll of the panel notes the line in sight, once per frame
    scrolled = 150;
    const panel = view.container.querySelector('[data-scroller]')!;
    act(() => {
      panel.dispatchEvent(new Event('scroll'));
      panel.dispatchEvent(new Event('scroll'));
    });
    expect(frames).toHaveLength(1);
    runFrames();
    view.rerender(<Panel lines={lines('e', 'd', 'c', 'b', 'a')} />);
    // two lines came in above "b": the panel moves on by them, "b" stands where it stood
    expect(scrolled).toBe(150 + 2 * LINE);
    // a line above goes: the panel moves back by it
    view.rerender(<Panel lines={lines('d', 'c', 'b', 'a')} />);
    expect(scrolled).toBe(150 + LINE);
    // the person scrolls on: nothing to make good, the scroll stays where it went
    scrolled = 200;
    act(() => void panel.dispatchEvent(new Event('scroll')));
    runFrames();
    expect(scrolled).toBe(200);
    // a line above grows right after, and the next scroll notices it first: made good all the same
    heights = { d: LINE + 30 };
    act(() => void panel.dispatchEvent(new Event('scroll')));
    runFrames();
    expect(scrolled).toBe(230);
  });

  it('keeps the place when a line above grows without a render of its own (a run whose log unfolds)', () => {
    const view = render(<Panel lines={lines('run', 'b', 'a')} />);
    scrolled = 150;
    act(() => void view.container.querySelector('[data-scroller]')!.dispatchEvent(new Event('scroll')));
    runFrames();
    heights = { run: LINE + 120 };
    resized(view.container.querySelector('ol')!);
    expect(scrolled).toBe(150 + 120);
    // what stands above the list in the panel is watched too
    expect(observers[0]!.targets).toContain(view.container.querySelector('[data-content]'));
  });

  it('lets a new line show on top while the start is in sight', () => {
    const view = render(<Panel lines={lines('b', 'a')} />);
    view.rerender(<Panel lines={lines('c', 'b', 'a')} />);
    expect(scrolled).toBe(0);
  });

  it('moves the page when the list scrolls with it, and watches a list that comes anew', () => {
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
    const view = render(<Lines lines={lines()} />);
    expect(observers).toEqual([]);
    view.rerender(<Lines lines={lines('b', 'a')} />);
    expect(observers[0]!.targets).toContain(document.body);
    scrolled = 120;
    act(() => void window.dispatchEvent(new Event('scroll')));
    runFrames();
    view.rerender(<Lines lines={lines('c', 'b', 'a')} />);
    expect(scrollBy).toHaveBeenCalledWith(0, LINE);
    // nothing moved above the place: the page stays
    scrollBy.mockClear();
    view.rerender(<Lines lines={lines('c', 'b', 'a', 'z')} />);
    expect(scrollBy).not.toHaveBeenCalled();

    // the list goes and comes back as another element: the old watch ends, a new one starts
    view.rerender(<Lines lines={lines()} />);
    expect(observers[0]!.on).toBe(false);
    view.rerender(<Lines lines={lines('a')} />);
    expect(observers[1]!.on).toBe(true);
    const remove = vi.spyOn(window, 'removeEventListener');
    view.unmount();
    expect(observers[1]!.on).toBe(false);
    expect(remove.mock.calls.map(([type]) => type)).toContain('scroll');
  });
});
