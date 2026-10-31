<?php

namespace App\RichText;

/**
 * The nodes and marks werkbuch stores (spec 4.16): the level `page` of the editor (`presets.ts`), which knows every
 * other level's nodes. The levels only narrow what the editor offers; the server keeps any of these. Phase 7 adds
 * mentions, references and attachments.
 *
 * The names and attributes are Tiptap 3's (`StarterKit`, `TaskList`, `TaskItem`, `TableKit`), because the client sends
 * what `editor.getJSON()` gives. `ATTRS` holds each attribute with its default and its kind; a document is read the way
 * ProseMirror's `nodeFromJSON` reads it: missing attributes take the default, unknown ones are dropped.
 */
final class Schema
{
    public const NODES = ['doc', 'paragraph', 'text', 'heading', 'bulletList', 'orderedList', 'listItem', 'taskList', 'taskItem', 'blockquote', 'codeBlock', 'hardBreak', 'horizontalRule', 'table', 'tableRow', 'tableHeader', 'tableCell'];

    public const MARKS = ['bold', 'italic', 'strike', 'code', 'link'];

    public const HEADING_LEVELS = [1, 2, 3];

    /** The largest document, as compact JSON in UTF-8. */
    public const MAX_BYTES = 262144;

    /** The deepest node below `doc` (a paragraph in a blockquote is at 2). */
    public const MAX_DEPTH = 32;

    /** Nodes that stand between other blocks. */
    public const BLOCKS = ['paragraph', 'heading', 'bulletList', 'orderedList', 'taskList', 'blockquote', 'codeBlock', 'horizontalRule', 'table'];

    /** What each node may hold; a node that is missing here holds nothing. */
    public const CHILDREN = [
        'doc' => self::BLOCKS,
        'paragraph' => ['text', 'hardBreak'],
        'heading' => ['text', 'hardBreak'],
        'codeBlock' => ['text'],
        'bulletList' => ['listItem'],
        'orderedList' => ['listItem'],
        'taskList' => ['taskItem'],
        'listItem' => self::BLOCKS,
        'taskItem' => self::BLOCKS,
        'blockquote' => self::BLOCKS,
        'table' => ['tableRow'],
        'tableRow' => ['tableCell', 'tableHeader'],
        'tableCell' => self::BLOCKS,
        'tableHeader' => self::BLOCKS,
    ];

    /** Nodes whose text carries no marks. */
    public const UNMARKED = ['codeBlock'];

    private const CELL = ['colspan' => [1, 'count'], 'rowspan' => [1, 'count'], 'colwidth' => [null, 'widths'], 'align' => [null, 'align']];

    /**
     * The attributes of a node or mark: name => [default, kind]. Kinds: `level` (one of HEADING_LEVELS), `int`, `count`
     * (1 or more), `bool`, `text` (a string or null), `language` (a code language or null), `widths` (a list of whole
     * numbers or null), `align` (`left`, `center`, `right` or null), `href` (a string; see LINK_PROTOCOLS).
     */
    public const ATTRS = [
        'heading' => ['level' => [1, 'level']],
        'orderedList' => ['start' => [1, 'int'], 'type' => [null, 'text']],
        'codeBlock' => ['language' => [null, 'language']],
        'taskItem' => ['checked' => [false, 'bool']],
        'tableCell' => self::CELL,
        'tableHeader' => self::CELL,
        'link' => ['href' => [null, 'href'], 'target' => ['_blank', 'text'], 'rel' => ['noopener noreferrer nofollow', 'text'], 'class' => [null, 'text'], 'title' => [null, 'text']],
    ];

    /** A link keeps its mark only with one of these; any other `href` loses the mark and keeps its text (P27). */
    public const LINK_PROTOCOLS = ['http', 'https', 'mailto'];

    /** A code block's language: it ends up in a Markdown fence and an HTML class. */
    public const LANGUAGE_PATTERN = '/\A[A-Za-z0-9_+#.-]{1,32}\z/';
}
