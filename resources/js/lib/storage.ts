/*
 * localStorage that never throws: a private window, blocked site data or a sandboxed frame refuse it; the value then
 * lasts until the page reloads.
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
