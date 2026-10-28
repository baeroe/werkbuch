import { useEffect } from 'react';

/** Names the browser tab after the screen while it is shown: "Inbox – werkbuch" (WCAG 2.4.2). */
export function useDocumentTitle(title: string | null | undefined): void {
  useEffect(() => {
    if (!title) return;
    const previous = document.title;
    document.title = `${title} – werkbuch`;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
