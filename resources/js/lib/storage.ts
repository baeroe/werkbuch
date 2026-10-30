/*
 * localStorage that never throws. A browser with blocked storage, a private window or a sandboxed frame (the review
 * build published as an artifact) refuses it; the demo then keeps its state in memory until the page reloads.
 */

import type { StateStorage } from 'zustand/middleware';

export const safeStorage: StateStorage = {
  getItem: (name) => {
    try {
      return localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      localStorage.setItem(name, value);
    } catch {
      // refused: the value lasts until reload
    }
  },
  removeItem: (name) => {
    try {
      localStorage.removeItem(name);
    } catch {
      // refused: nothing was stored either
    }
  },
};
