import { describe, expect, it, vi } from 'vitest';
import { isLiveConnected, subscribeLive, subscribeLiveStatus } from './live';

describe('the live stub', () => {
  it('reports a connection', () => {
    expect(isLiveConnected()).toBe(true);
  });

  it('hands out unsubscribers that do nothing, and delivers nothing', () => {
    const onEvent = vi.fn();
    const onStatus = vi.fn();

    const stopEvents = subscribeLive(onEvent);
    const stopStatus = subscribeLiveStatus(onStatus);

    expect(() => {
      stopEvents();
      stopStatus();
    }).not.toThrow();
    expect(onEvent).not.toHaveBeenCalled();
    expect(onStatus).not.toHaveBeenCalled();
  });
});
