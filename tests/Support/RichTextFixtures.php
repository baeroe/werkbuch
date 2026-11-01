<?php

namespace Tests\Support;

/**
 * Tiptap documents in the form the editor sends (`editor.getJSON()`: every attribute of a node with its value).
 */
final class RichTextFixtures
{
    /** The steps of WEB-47 in the clickdummy (`seed/items.ts`): a paragraph and a numbered list of three. */
    public static function web47Steps(): array
    {
        return self::doc(
            self::p('So lässt sich der Fehler nachstellen:'),
            ['type' => 'orderedList', 'attrs' => ['start' => 1, 'type' => null], 'content' => [
                self::li(self::p('Die Formularseite in Safari (iOS 18) öffnen.')),
                self::li(self::p('Alle Felder ausfüllen und auf „Absenden“ tippen.')),
                self::li(self::p('Im Postfach des Teams liegen zwei identische Mails.')),
            ]],
        );
    }

    /** Every node and mark of App\RichText\Schema once at least. */
    public static function everyNode(): array
    {
        return self::doc(
            ['type' => 'heading', 'attrs' => ['level' => 2], 'content' => [self::text('Doppelte Mails')]],
            self::p(
                self::text('Das Formular '),
                self::text('muss', 'bold'),
                self::text(' '),
                self::text('einmal', 'italic'),
                self::text(' senden, '),
                self::text('zweimal', 'strike'),
                self::text(' ist falsch: '),
                self::text('submit()', 'code'),
                self::text('.'),
                ['type' => 'hardBreak'],
                self::text('Mehr unter '),
                ['type' => 'text', 'marks' => [['type' => 'link', 'attrs' => self::link('https://example.com')]], 'text' => 'Doku'],
                self::text('.'),
            ),
            ['type' => 'bulletList', 'content' => [
                self::li(self::p('Safari')),
                self::li(
                    self::p('Firefox'),
                    ['type' => 'orderedList', 'attrs' => ['start' => 1, 'type' => null], 'content' => [self::li(self::p('Version 130'))]],
                ),
            ]],
            ['type' => 'orderedList', 'attrs' => ['start' => 3, 'type' => null], 'content' => [self::li(self::p('Öffnen')), self::li(self::p('Absenden'))]],
            ['type' => 'taskList', 'content' => [
                ['type' => 'taskItem', 'attrs' => ['checked' => true], 'content' => [self::p('Fehler nachgestellt')]],
                ['type' => 'taskItem', 'attrs' => ['checked' => false], 'content' => [self::p('Fix geprüft')]],
            ]],
            ['type' => 'blockquote', 'content' => [self::p('Zwei Mails im Postfach.')]],
            ['type' => 'codeBlock', 'attrs' => ['language' => 'php'], 'content' => [self::text("\$form->submit();\n\$form->submit();")]],
            ['type' => 'horizontalRule'],
            ['type' => 'table', 'content' => [
                ['type' => 'tableRow', 'content' => [self::cell('tableHeader', 'Browser'), self::cell('tableHeader', 'Mails')]],
                ['type' => 'tableRow', 'content' => [self::cell('tableCell', 'Safari'), self::cell('tableCell', '2')]],
            ]],
        );
    }

    /** The attributes of a link mark as the editor sends them. */
    public static function link(string $href): array
    {
        return ['href' => $href, 'target' => '_blank', 'rel' => 'noopener noreferrer nofollow', 'class' => null, 'title' => null];
    }

    public static function doc(array ...$blocks): array
    {
        return ['type' => 'doc', 'content' => $blocks];
    }

    /** A paragraph of a text, or of inline nodes. */
    public static function p(string|array ...$inline): array
    {
        return ['type' => 'paragraph', 'content' => array_map(fn ($node) => is_string($node) ? self::text($node) : $node, $inline)];
    }

    public static function text(string $text, ?string $mark = null): array
    {
        return $mark === null ? ['type' => 'text', 'text' => $text] : ['type' => 'text', 'marks' => [['type' => $mark]], 'text' => $text];
    }

    private static function li(array ...$blocks): array
    {
        return ['type' => 'listItem', 'content' => $blocks];
    }

    private static function cell(string $type, string $text): array
    {
        return ['type' => $type, 'attrs' => ['colspan' => 1, 'rowspan' => 1, 'colwidth' => null, 'align' => null], 'content' => [self::p($text)]];
    }
}
