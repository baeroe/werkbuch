type NavigatorWithUAData = Navigator & { userAgentData?: { platform?: string } };

/** macOS and iOS: `mod` is ⌘ there and Strg everywhere else. */
export function isMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  const platform = (navigator as NavigatorWithUAData).userAgentData?.platform || navigator.platform || '';
  return /mac|iphone|ipad|ipod/i.test(platform);
}
