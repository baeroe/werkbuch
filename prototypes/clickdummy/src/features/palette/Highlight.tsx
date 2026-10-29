import { Fragment } from 'react';

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The text with every typed word marked by the highlighter (DESIGN.md: hits in the search). */
export function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (terms.length === 0) return <>{text}</>;
  // longer words first, so "kontakt" wins over "kon"; the capturing group keeps the hits in the split (odd parts)
  const alternatives = [...terms].sort((a, b) => b.length - a.length).map(escape);
  const parts = text.split(new RegExp(`(${alternatives.join('|')})`, 'gi'));
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <mark key={index} className="hl">
            {part}
          </mark>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}
