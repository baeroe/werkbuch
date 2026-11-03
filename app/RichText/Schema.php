<?php

namespace App\RichText;

/**
 * The nodes and marks werkbuch stores (spec 4.16): the level `page` of the editor (`presets.ts`), which knows every
 * other level's nodes. The levels only narrow what the editor offers; the server keeps any of these.
 *
 * The names and attributes are Tiptap 3's (`StarterKit`, `TaskList`, `TaskItem`, `TableKit`), because the client sends
 * what `editor.getJSON()` gives. `ATTRS` holds each attribute with its default and its kind; a document is read the way
 * ProseMirror's `nodeFromJSON` reads it: missing attributes take the default, unknown ones are dropped.
 *
 * The nodes of Phase 7 stand for something outside the text and carry only its ID, never a URL, a path, a key or a
 * title: `mention` (a person: `id`, the `label` the handle had when it was written), `reference` (an item or, from
 * Phase 9, a page: `id`, `kind`; the editor's label is never stored), `image` (a block: `attachmentId`, `alt`) and
 * `attachment` (a file in the text: `attachmentId`, `filename`). An image with a `src` (pasted HTML, `![](https://…)`)
 * becomes no node.
 */
final class Schema
{
    public const NODES = ['doc', 'paragraph', 'text', 'heading', 'bulletList', 'orderedList', 'listItem', 'taskList', 'taskItem', 'blockquote', 'codeBlock', 'hardBreak', 'horizontalRule', 'table', 'tableRow', 'tableHeader', 'tableCell', 'mention', 'reference', 'image', 'attachment'];

    public const MARKS = ['bold', 'italic', 'strike', 'code', 'link'];

    /**
     * The marks of a text node in the order the editor writes them (`Mark.setFrom` sorts by rank in the schema): the
     * link first (priority 1000), then StarterKit's order. Document sorts by it, so a text reads the same in both.
     */
    public const MARK_ORDER = ['link', 'bold', 'code', 'italic', 'strike'];

    public const HEADING_LEVELS = [1, 2, 3];

    /** The largest document, as compact JSON in UTF-8. */
    public const MAX_BYTES = 262144;

    /** The deepest node below `doc` (a paragraph in a blockquote is at 2). */
    public const MAX_DEPTH = 32;

    /** Nodes that stand between other blocks. */
    public const BLOCKS = ['paragraph', 'heading', 'bulletList', 'orderedList', 'taskList', 'blockquote', 'codeBlock', 'horizontalRule', 'table', 'image'];

    /** Nodes inside a line of text that hold nothing (Tiptap's `atom`); like text they may carry marks. */
    public const INLINE_ATOMS = ['mention', 'reference', 'attachment'];

    /** What a reference points to: an item, or a wiki page (Phase 9). */
    public const REFERENCE_KINDS = ['item', 'page'];

    /** What each node may hold; a node that is missing here holds nothing. */
    public const CHILDREN = [
        'doc' => self::BLOCKS,
        'paragraph' => ['text', 'hardBreak', ...self::INLINE_ATOMS],
        'heading' => ['text', 'hardBreak', ...self::INLINE_ATOMS],
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

    /**
     * The order and number of a node's children: Tiptap 3.32's content expressions, `block` standing for BLOCKS. A
     * node missing here takes its CHILDREN in any order and number (`inline*`, `text*`). The doc is Tiptap's `block+`
     * written as `block*`: ProseMirror fills an empty doc with a paragraph, werkbuch stores it empty (`isEmpty`).
     */
    public const CONTENT = [
        'doc' => 'block*',
        'bulletList' => 'listItem+',
        'orderedList' => 'listItem+',
        'taskList' => 'taskItem+',
        'listItem' => 'paragraph block*',
        'taskItem' => 'paragraph block*',
        'blockquote' => 'block+',
        'table' => 'tableRow+',
        'tableRow' => '(tableCell | tableHeader)*',
        'tableCell' => 'block+',
        'tableHeader' => 'block+',
    ];

    /** Nodes whose text carries no marks. */
    public const UNMARKED = ['codeBlock'];

    private const CELL = ['colspan' => [1, 'count'], 'rowspan' => [1, 'count'], 'colwidth' => [null, 'widths'], 'align' => [null, 'align']];

    /**
     * The attributes of a node or mark: name => [default, kind]. Kinds: `level` (one of HEADING_LEVELS), `int` (a whole
     * number from 0 to LIST_START_MAX), `count` (1 or more), `bool`, `text` (a string or null), `ulid` (a ULID in either
     * case, stored in small letters; never null, so a node without its ID is refused), `kind` (one of REFERENCE_KINDS),
     * `language` (a code
     * language or null), `widths` (a list of whole numbers above 0, or null), `align` (`left`, `center`, `right` or
     * null), `fixed` (always the default, whatever the input says: a link's `class`, `rel` and `target` are the
     * editor's, never a member's, so no stored class can turn a link into a page-covering click trap; the suggestion
     * character of a mention and a reference; the label of a reference, which would name an item for every reader of
     * the text). A link's `href`
     * is a string or null; see LINK_PROTOCOLS. A value of a kind in LENIENT that does not fit becomes the default (pasted
     * HTML brings `colspan="0"`, `start="x"` or a long class name as language: noise that must not refuse the text);
     * any other kind that does not fit refuses the document.
     */
    public const ATTRS = [
        'heading' => ['level' => [1, 'level']],
        'orderedList' => ['start' => [1, 'int'], 'type' => [null, 'text']],
        'codeBlock' => ['language' => [null, 'language']],
        'taskItem' => ['checked' => [false, 'bool']],
        'tableCell' => self::CELL,
        'tableHeader' => self::CELL,
        'mention' => ['id' => [null, 'ulid'], 'label' => [null, 'text'], 'mentionSuggestionChar' => ['@', 'fixed']],
        'reference' => ['id' => [null, 'ulid'], 'label' => [null, 'fixed'], 'mentionSuggestionChar' => ['#', 'fixed'], 'kind' => ['item', 'kind']],
        'image' => ['attachmentId' => [null, 'ulid'], 'alt' => [null, 'text']],
        'attachment' => ['attachmentId' => [null, 'ulid'], 'filename' => [null, 'text']],
        'link' => ['href' => [null, 'text'], 'target' => ['_blank', 'fixed'], 'rel' => ['noopener noreferrer nofollow', 'fixed'], 'class' => [null, 'fixed'], 'title' => [null, 'text']],
    ];

    /** The kinds whose odd values fall back to their default instead of refusing the document (A150). */
    public const LENIENT = ['int', 'count', 'widths', 'language'];

    /** The largest start of an ordered list: CommonMark takes at most nine digits, so Markdown can carry it. */
    public const LIST_START_MAX = 999_999_999;

    /** A link keeps its mark only with one of these; any other `href` loses the mark and keeps its text (P27). */
    public const LINK_PROTOCOLS = ['http', 'https', 'mailto'];

    /** A code block's language: it ends up in a Markdown fence and an HTML class. */
    public const LANGUAGE_PATTERN = '/\A[A-Za-z0-9_+#.-]{1,32}\z/';
}
