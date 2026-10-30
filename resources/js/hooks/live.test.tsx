import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useLiveConnected } from './live';

describe('useLiveConnected', () => {
  it('is true while the stub is the connection', () => {
    const { result } = renderHook(() => useLiveConnected());

    expect(result.current).toBe(true);
  });
});
