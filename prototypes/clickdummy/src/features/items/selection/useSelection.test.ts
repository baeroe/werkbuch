import { describe, expect, it } from 'vitest';
import { nextInOrder, rangeBetween, selectRange, toggleId } from './useSelection';

const order = ['a', 'b', 'c', 'd', 'e'];

describe('selection', () => {
  it('x toggles one item in and out of the selection', () => {
    expect(toggleId([], 'b')).toEqual(['b']);
    expect(toggleId(['a', 'b'], 'b')).toEqual(['a']);
  });

  it('a shift range selects everything between the anchor and the item, in either direction', () => {
    expect(rangeBetween(order, 'b', 'd')).toEqual(['b', 'c', 'd']);
    expect(rangeBetween(order, 'd', 'b')).toEqual(['b', 'c', 'd']);
    // added to what is selected, each id once, in the order of the list
    expect(selectRange(['e', 'b'], order, 'b', 'd')).toEqual(['b', 'c', 'd', 'e']);
  });

  it('a range from an anchor that is gone starts at the item itself', () => {
    expect(rangeBetween(order, 'gone', 'c')).toEqual(['c']);
    expect(rangeBetween(order, null, 'c')).toEqual(['c']);
  });

  it('moves the cursor through the order, starting at the first item and stopping at the ends', () => {
    expect(nextInOrder(order, null, 1)).toBe('a');
    expect(nextInOrder(order, null, -1)).toBe('e');
    expect(nextInOrder(order, 'b', 1)).toBe('c');
    expect(nextInOrder(order, 'e', 1)).toBe('e');
    expect(nextInOrder(order, 'a', -1)).toBe('a');
    expect(nextInOrder([], null, 1)).toBeNull();
  });
});
