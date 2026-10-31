import { describe, expect, it } from 'vitest';
import type { RichText } from '@/types';
import { docToText, isBlankDoc, isPlainDoc, plainDocText, plainText, textDoc } from './richtext';

const text = (value: string, marks?: RichText['marks']): RichText => (marks ? { type: 'text', text: value, marks } : { type: 'text', text: value });
const paragraph = (...content: RichText[]): RichText => (content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' });
const doc = (...content: RichText[]): RichText => ({ type: 'doc', content });
const list = (type: 'bulletList' | 'orderedList' | 'taskList', ...items: string[]): RichText => ({
  type,
  content: items.map((item) => ({ type: type === 'taskList' ? 'taskItem' : 'listItem', content: [paragraph(text(item))] })),
});

describe('plainText', () => {
  it('joins the text of the blocks with a space and keeps the words of an inline run together', () => {
    const document = doc(
      { type: 'heading', attrs: { level: 2 }, content: [text('Ablauf')] },
      paragraph(text('Mail '), text('zweimal', [{ type: 'bold' }]), text(' gesendet')),
      list('bulletList', 'erst', 'dann'),
    );

    expect(plainText(document)).toBe('Ablauf Mail zweimal gesendet erst dann');
  });

  it('reads a line break and a rule as a gap and squeezes the white space', () => {
    expect(plainText(doc(paragraph(text('eins'), { type: 'hardBreak' }, text('zwei')), { type: 'horizontalRule' }, paragraph(text('  drei  '))))).toBe('eins zwei drei');
  });

  it('is empty for no document and for one without text', () => {
    expect(plainText(null)).toBe('');
    expect(plainText(undefined)).toBe('');
    expect(plainText(doc(paragraph()))).toBe('');
  });
});

describe('docToText', () => {
  it('separates blocks by a blank line and puts list items on lines of their own', () => {
    const document = doc(paragraph(text('Schritte:')), list('orderedList', 'öffnen', 'senden'), list('bulletList', 'Mail'), list('taskList', 'prüfen'), paragraph());

    expect(docToText(document)).toBe('Schritte:\n\n1. öffnen\n2. senden\n\n- Mail\n\n- prüfen');
  });

  it('is empty for no document and for one without blocks', () => {
    expect(docToText(null)).toBe('');
    expect(docToText({ type: 'doc' })).toBe('');
    expect(docToText({ type: 'doc', content: [{ type: 'bulletList' }] })).toBe('');
  });
});

describe('textDoc and plainDocText', () => {
  it('turns a blank line into a new paragraph and a single line break into a hard break', () => {
    const document = textDoc('Erste Zeile\nzweite Zeile\n\n\nNeuer Absatz\n');

    expect(document).toEqual(doc(paragraph(text('Erste Zeile'), { type: 'hardBreak' }, text('zweite Zeile')), paragraph(text('Neuer Absatz'))));
    expect(plainDocText(document)).toBe('Erste Zeile\nzweite Zeile\n\nNeuer Absatz');
  });

  it('keeps an empty line inside a block and gives one empty paragraph for no text', () => {
    expect(textDoc('a\n \nb')).toEqual(doc(paragraph(text('a')), paragraph(text('b'))));
    expect(textDoc('a\n b')).toEqual(doc(paragraph(text('a'), { type: 'hardBreak' }, text(' b'))));
    expect(textDoc('')).toEqual(doc(paragraph()));
    expect(textDoc('  \n\n ')).toEqual(doc(paragraph()));
    expect(plainDocText(textDoc(''))).toBe('');
  });

  it('reads nothing from no document', () => {
    expect(plainDocText(null)).toBe('');
    expect(plainDocText({ type: 'doc' })).toBe('');
  });
});

describe('isPlainDoc', () => {
  it('accepts no document and paragraphs of unmarked text with line breaks', () => {
    expect(isPlainDoc(null)).toBe(true);
    expect(isPlainDoc({ type: 'doc' })).toBe(true);
    expect(isPlainDoc(textDoc('eins\nzwei\n\ndrei'))).toBe(true);
  });

  it('refuses what a plain text field would lose: marks, other blocks, other roots', () => {
    expect(isPlainDoc(doc(paragraph(text('fett', [{ type: 'bold' }]))))).toBe(false);
    expect(isPlainDoc(doc(list('bulletList', 'Punkt')))).toBe(false);
    expect(isPlainDoc(paragraph(text('kein doc')))).toBe(false);
  });
});

describe('isBlankDoc', () => {
  it('is blank without a document, for an emptied editor and for white space only', () => {
    expect(isBlankDoc(null)).toBe(true);
    expect(isBlankDoc(doc(paragraph()))).toBe(true);
    expect(isBlankDoc(doc(paragraph(text('   '))))).toBe(true);
    expect(isBlankDoc(doc(paragraph(text('x'))))).toBe(false);
  });
});
