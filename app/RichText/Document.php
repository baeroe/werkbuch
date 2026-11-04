<?php

namespace App\RichText;

use App\Domain\Ulid;
use App\RichText\Nodes\AttachmentFile;
use App\RichText\Nodes\AttachmentImage;
use App\RichText\Nodes\Mention;
use App\RichText\Nodes\Reference;
use Tiptap\Core\Mark;
use Tiptap\Core\Node;
use Tiptap\Editor;
use Tiptap\Marks;
use Tiptap\Nodes;

/**
 * A rich text as werkbuch stores it: Tiptap JSON of the nodes of Schema, the form the editor sends. It reads and writes
 * Markdown (REST, MCP), plain text (search, `description_text`), HTML and the HTML of mails. Nothing a user typed as
 * HTML is ever output as HTML: Markdown reads HTML as text, and the HTML comes from the nodes.
 *
 * It reads mentions, references, images and files only as structure and names their IDs (`mentionedUserIds()`,
 * `attachmentIds()`, `itemRefs()`, `pageRefs()`); what they mean for a writer or a reader (may this person be
 * mentioned, does the reader see this item) is decided outside of it, `withNodes()` applies the outcome.
 */
final class Document
{
    private const JSON_FLAGS = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE;

    /** Nodes that are content on their own, without any text (`isEmptyDoc` in the editor). */
    private const CONTENT_ATOMS = ['horizontalRule', 'table', 'image', ...Schema::INLINE_ATOMS];

    /** The nodes that stand for something outside the text; withNodes() maps them. */
    private const OUTSIDE = ['image', ...Schema::INLINE_ATOMS];

    /** Marks that the nodes of OUTSIDE lose in Markdown (toMarkdown()). */
    private const MARKDOWN_UNMARKED = ['code', 'link'];

    /** Nodes whose text makes one line of `toText()`. */
    private const TEXT_BLOCKS = ['paragraph', 'heading', 'codeBlock'];

    /** @param array<string, mixed> $json */
    private function __construct(private readonly array $json) {}

    /**
     * Reads a document the way the editor's schema does: missing attributes take their default, unknown attributes
     * are dropped, a link to anything but Schema::LINK_PROTOCOLS loses its mark and keeps its text, an odd value of a
     * lenient attribute (Schema::LENIENT: list start, cell spans and widths, code language) takes its default. Like
     * ProseMirror it orders the marks of a text (Schema::MARK_ORDER), keeps the first of a repeated mark and joins
     * neighbouring texts with the same marks, so the stored JSON is what `editor.getJSON()` gives for it. Everything
     * else that does not fit is refused, also children against the editor's content expressions (Schema::CONTENT).
     *
     * @param  array<mixed>  $json
     *
     * @throws InvalidDocument
     */
    public static function fromJson(array $json): self
    {
        if (($json['type'] ?? null) !== 'doc') {
            throw new InvalidDocument('shape');
        }
        $document = self::node($json, 'doc', 0);
        if (strlen((string) json_encode($document, self::JSON_FLAGS)) > Schema::MAX_BYTES) {
            throw new InvalidDocument('size');
        }

        return new self($document);
    }

    /**
     * Reads Markdown (CommonMark with GitHub's tables, task lists, strikethrough and autolinks). HTML in it stays
     * text. Markdown longer than Schema::MAX_BYTES is refused before it is parsed (its JSON is never shorter in
     * practice); even within that, parsing can take a while: callers parse before they take locks.
     *
     * @throws InvalidDocument
     */
    public static function fromMarkdown(string $markdown, MarkdownContext $ctx): self
    {
        if (strlen($markdown) > Schema::MAX_BYTES) {
            throw new InvalidDocument('size');
        }
        if (! mb_check_encoding($markdown, 'UTF-8')) {
            throw new InvalidDocument('shape');
        }
        $html = Markdown::toHtml($markdown, $ctx);
        // tiptap-php cannot read an empty body
        $json = $html === '' ? ['type' => 'doc'] : self::editor()->setContent($html)->getDocument();

        return self::fromJson(is_array($json) ? $json : []);
    }

    /** @return array<string, mixed> */
    public function toJson(): array
    {
        return $this->json;
    }

    /**
     * The document as Markdown for one reader; Markdown::fromHtml() lists how it is written. A mention is `@` and the
     * current handle (`$names->handles`, else its label if that is a handle; nothing without either), a reference to an
     * item the reader sees (`$names->items`) its current key, to a page the reader sees (`$names->pages`)
     * `[<current title>](page:<ulid>)`, any other `[hidden](<kind>:<ulid>)` (no key, no title), an image
     * `![alt](attachment:<ulid>)` and a file `[name](attachment:<ulid>)`; text that would read as a mention or a key
     * gets a backslash (`\@mara`, `WEB\-47`). Read back with the same lookup and the kept IDs (MarkdownContext), it
     * gives the same JSON, but for the code and link marks of mentions, references and files: Markdown reads nothing
     * in code and nests no link in a link, so they are left out for the nodes to stay.
     */
    public function toMarkdown(?RichTextNames $names = null): string
    {
        $json = self::mapped($this->json, fn (array $node) => self::withoutMarks($node, self::MARKDOWN_UNMARKED));

        return Markdown::fromHtml((new self(self::node($json, 'doc', 0)))->toHtml(), $names ?? new RichTextNames);
    }

    /**
     * The text without any markup: one line per paragraph, heading or code block, a line break as a line break. Without
     * names (the stored `description_text`, `body_text`, `value_text`, `content_text`) a mention is `@` and its label
     * and a reference nothing; for one reader (`$names`, ReaderNames; excerpts of the inbox, K13) a mention is `@` and
     * the current name, a reference to an item the reader sees its key and title, to a page the reader sees its title,
     * any other `richtext.hidden` (no key, no title), as in a mail.
     */
    public function toText(?RichTextNames $names = null): string
    {
        $lines = [];
        self::lines($this->json, $lines, $names);

        return implode("\n", array_filter($lines, fn (string $line) => trim($line) !== ''));
    }

    public function toHtml(): string
    {
        // tiptap-php cannot render a doc without content
        return isset($this->json['content']) ? self::editor()->setContent($this->json)->getHTML() : '';
    }

    /**
     * Whether the document holds nothing: no text but blanks, no rule, no table, no mention, reference, image or file
     * (an emptied editor).
     */
    public function isEmpty(): bool
    {
        return ! self::hasContent($this->json);
    }

    /**
     * The HTML of a mail to one reader (spec 4.14): a mention as `@` and the name, a reference to an item the reader
     * sees as a link to the item with its key and title, to a page the reader sees as a link to its wiki address
     * (`/projects/<IDENTIFIER>/wiki/<id>`, A316) with its title, any other as `richtext.hidden` (no key, no title, no
     * ID), an image as a link
     * `richtext.image` to the file (never embedded), a file as a link with its name. Images and files take their alt
     * text or file name, else the name the caller gives for the attachment's ID, else the ID. Everything is text of
     * the standard nodes, so tiptap-php escapes it. The caller sets the reader's language.
     */
    public function toMailHtml(RichTextNames $names, string $appUrl): string
    {
        $base = rtrim($appUrl, '/');
        $mail = self::mapped($this->json, fn (array $node) => self::forMail($node, $names, $base));

        // no size check: the mail is never stored, and keys and titles make it longer than the text
        return (new self(self::node($mail, 'doc', 0)))->toHtml();
    }

    /**
     * The people the text mentions, without repeats, in the order of the text.
     *
     * @return list<string>
     */
    public function mentionedUserIds(): array
    {
        return self::ids(self::nodesOf($this->json, ['mention']), 'id');
    }

    /**
     * The attachments of the images and files of the text, without repeats, in the order of the text.
     *
     * @return list<string>
     */
    public function attachmentIds(): array
    {
        return self::ids(self::nodesOf($this->json, ['image', 'attachment']), 'attachmentId');
    }

    /**
     * The items the text refers to, without repeats, in the order of the text.
     *
     * @return list<string>
     */
    public function itemRefs(): array
    {
        return self::refs($this->json, 'item');
    }

    /**
     * The pages the text refers to, without repeats, in the order of the text.
     *
     * @return list<string>
     */
    public function pageRefs(): array
    {
        return self::refs($this->json, 'page');
    }

    /**
     * A new document in which `$map` replaces each mention, reference, image and file: with the node it returns, with
     * a text (it takes the node's marks; an image's text becomes a paragraph, an image being a block), or with nothing
     * for `null` or an empty text. The result is read like any document (fromJson): neighbouring texts are joined, and
     * what does not fit is refused.
     *
     * @param  callable(array<string, mixed>): (array<string, mixed>|string|null)  $map
     *
     * @throws InvalidDocument
     */
    public function withNodes(callable $map): self
    {
        return self::fromJson(self::mapped($this->json, $map));
    }

    /**
     * @param  array<mixed>  $node
     * @return array<string, mixed>
     */
    private static function node(array $node, string $type, int $depth): array
    {
        if ($depth > Schema::MAX_DEPTH) {
            throw new InvalidDocument('depth');
        }
        $allowed = match (true) {
            $type === 'text' => ['type', 'marks', 'text'],
            in_array($type, Schema::INLINE_ATOMS, true) => ['type', 'attrs', 'marks'],
            $type === 'image' => ['type', 'attrs'],
            default => ['type', 'attrs', 'content'],
        };
        if (array_diff(array_keys($node), $allowed) !== []) {
            throw new InvalidDocument('shape');
        }
        $read = ['type' => $type];
        if (isset(Schema::ATTRS[$type])) {
            $read['attrs'] = self::attrs($node['attrs'] ?? [], Schema::ATTRS[$type]);
        }
        $content = self::list($node['content'] ?? []);
        if ($content !== []) {
            $read['content'] = self::joined(array_map(fn (mixed $child) => self::child($child, $type, $depth + 1), $content));
        }
        if (! self::fitsContent($type, array_column($read['content'] ?? [], 'type'))) {
            throw new InvalidDocument('shape');
        }
        $marks = self::marks(self::list($node['marks'] ?? []));
        if ($marks !== []) {
            $read['marks'] = $marks;
        }
        if ($type !== 'text') {
            return $read;
        }
        // a text that is no UTF-8 (form-encoded input can carry it) would break Markdown and the JSON column later
        if (! is_string($node['text'] ?? null) || $node['text'] === '' || ! mb_check_encoding($node['text'], 'UTF-8')) {
            throw new InvalidDocument('shape');
        }
        $read['text'] = $node['text'];

        return $read;
    }

    /** @return array<string, mixed> */
    private static function child(mixed $child, string $parent, int $depth): array
    {
        $type = is_array($child) ? ($child['type'] ?? null) : null;
        if (! is_string($type)) {
            throw new InvalidDocument('shape');
        }
        if (! in_array($type, Schema::NODES, true)) {
            throw new InvalidDocument('node');
        }
        if (! in_array($type, Schema::CHILDREN[$parent] ?? [], true)) {
            throw new InvalidDocument('shape');
        }
        $node = self::node((array) $child, $type, $depth);
        if (isset($node['marks']) && in_array($parent, Schema::UNMARKED, true)) {
            throw new InvalidDocument('shape');
        }

        return $node;
    }

    /**
     * @param  list<mixed>  $marks
     * @return list<array<string, mixed>>
     */
    private static function marks(array $marks): array
    {
        $read = [];
        foreach ($marks as $mark) {
            $type = is_array($mark) ? ($mark['type'] ?? null) : null;
            if (! is_string($type) || array_diff(array_keys((array) $mark), ['type', 'attrs']) !== []) {
                throw new InvalidDocument('shape');
            }
            if (! in_array($type, Schema::MARKS, true)) {
                throw new InvalidDocument('mark');
            }
            if (! isset(Schema::ATTRS[$type])) {
                $read[] = ['type' => $type];

                continue;
            }
            // only links have attributes
            $attrs = self::attrs(((array) $mark)['attrs'] ?? [], Schema::ATTRS[$type]);
            if (self::allowedHref($attrs['href'])) {
                $read[] = ['type' => $type, 'attrs' => $attrs];
            }
        }
        // the first of a repeated mark, in the editor's order
        $first = [];
        foreach ($read as $mark) {
            $first[$mark['type']] ??= $mark;
        }

        return array_values(array_filter(array_map(fn (string $type) => $first[$type] ?? null, Schema::MARK_ORDER)));
    }

    /**
     * Neighbouring texts with the same marks as one text, as ProseMirror's `Fragment.fromArray` joins them.
     *
     * @param  list<array<string, mixed>>  $children
     * @return list<array<string, mixed>>
     */
    private static function joined(array $children): array
    {
        $joined = [];
        foreach ($children as $child) {
            $last = array_key_last($joined);
            if ($last !== null && $child['type'] === 'text' && $joined[$last]['type'] === 'text' && ($child['marks'] ?? []) === ($joined[$last]['marks'] ?? [])) {
                $joined[$last]['text'] .= $child['text'];

                continue;
            }
            $joined[] = $child;
        }

        return $joined;
    }

    /**
     * Whether the children's types fit the node's content expression (Schema::CONTENT). Each term of an expression
     * takes as many children as it can (no term needs to give one back: the expressions are a first child and a
     * repetition), so a walk over the children decides it; a regular expression over 10,000 of them ran out of stack.
     *
     * @param  list<mixed>  $children
     */
    private static function fitsContent(string $type, array $children): bool
    {
        if (! isset(Schema::CONTENT[$type])) {
            return true;
        }
        $at = 0;
        $count = count($children);
        foreach (self::terms(Schema::CONTENT[$type]) as [$names, $repeat]) {
            $start = $at;
            while ($at < $count && isset($names[$children[$at]]) && ($repeat !== '' || $at === $start)) {
                $at++;
            }
            if ($at === $start && $repeat !== '*') {
                return false;
            }
        }

        return $at === $count;
    }

    /**
     * The terms of a content expression: the node names it takes (`block` standing for Schema::BLOCKS) as keys, and
     * its repetition (``, `*` or `+`).
     *
     * @return list<array{0: array<string, true>, 1: string}>
     */
    private static function terms(string $expression): array
    {
        static $read = [];
        if (isset($read[$expression])) {
            return $read[$expression];
        }
        preg_match_all('/(\([^)]*\)|\w+)([*+]?)/', $expression, $matches, PREG_SET_ORDER);
        $terms = [];
        foreach ($matches as [, $term, $repeat]) {
            $names = array_merge(...array_map(
                fn (string $name) => $name === 'block' ? Schema::BLOCKS : [$name],
                preg_split('/[\s()|]+/', $term, -1, PREG_SPLIT_NO_EMPTY) ?: [],
            ));
            $terms[] = [array_fill_keys($names, true), $repeat];
        }

        return $read[$expression] = $terms;
    }

    /**
     * @param  array<string, array{0: mixed, 1: string}>  $spec
     * @return array<string, mixed>
     */
    private static function attrs(mixed $given, array $spec): array
    {
        if (! is_array($given)) {
            throw new InvalidDocument('shape');
        }
        $attrs = [];
        foreach ($spec as $name => [$default, $kind]) {
            $value = $kind !== 'fixed' && array_key_exists($name, $given) ? $given[$name] : $default;
            if (! self::fits($kind, $value)) {
                $value = in_array($kind, Schema::LENIENT, true) ? $default : throw new InvalidDocument('shape');
            }
            $attrs[$name] = $kind === 'ulid' ? strtolower((string) $value) : $value;
        }

        return $attrs;
    }

    private static function fits(string $kind, mixed $value): bool
    {
        return match ($kind) {
            'level' => in_array($value, Schema::HEADING_LEVELS, true),
            'int' => is_int($value) && $value >= 0 && $value <= Schema::LIST_START_MAX,
            'count' => is_int($value) && $value >= 1,
            'bool' => is_bool($value),
            'language' => $value === null || (is_string($value) && preg_match(Schema::LANGUAGE_PATTERN, $value) === 1),
            'widths' => $value === null || (is_array($value) && array_is_list($value) && array_filter($value, fn (mixed $width) => is_int($width) && $width > 0) === $value),
            'align' => in_array($value, [null, 'left', 'center', 'right'], true),
            'ulid' => is_string($value) && Ulid::is($value),
            'kind' => in_array($value, Schema::REFERENCE_KINDS, true),
            default => $value === null || is_string($value),
        };
    }

    private static function allowedHref(mixed $href): bool
    {
        $protocols = implode('|', Schema::LINK_PROTOCOLS);

        return is_string($href) && preg_match("/\\A(?:{$protocols}):/i", $href) === 1;
    }

    /** @return list<mixed> */
    private static function list(mixed $value): array
    {
        if (! is_array($value) || ! array_is_list($value)) {
            throw new InvalidDocument('shape');
        }

        return $value;
    }

    /**
     * @param  array<string, mixed>  $node
     * @param  list<string>  $lines
     */
    private static function lines(array $node, array &$lines, ?RichTextNames $names): void
    {
        /** @var list<array<string, mixed>> $content */
        $content = $node['content'] ?? [];
        if (in_array($node['type'], self::TEXT_BLOCKS, true)) {
            // a node without text between two spaces leaves one of them (T14-M7): `mit WEB-1 zusammen` → `mit zusammen`
            $line = implode('', array_map(fn (array $inline) => self::inlineText($inline, $names) ?? "\0", $content));
            $lines[] = (string) preg_replace_callback('/( ?)\x00+( ?)/', fn (array $m) => $m[1] !== '' && $m[2] !== '' ? ' ' : $m[1].$m[2], $line);

            return;
        }
        if ($node['type'] === 'image') {
            $lines[] = (string) $node['attrs']['alt'];

            return;
        }
        foreach ($content as $child) {
            self::lines($child, $lines, $names);
        }
    }

    /**
     * The text of a node in a line: a mention as `@` and its label, a file as its name; `null` for a node without text
     * (a mention without a label, a reference: its key belongs to the reader who sees it). For one reader, mentions and
     * references read as in a mail (forMail()).
     *
     * @param  array<string, mixed>  $inline
     */
    private static function inlineText(array $inline, ?RichTextNames $names): ?string
    {
        $label = $inline['attrs']['label'] ?? null;
        if ($names !== null && in_array($inline['type'], ['mention', 'reference'], true)) {
            $id = (string) $inline['attrs']['id'];
            [$item, $page] = self::referred($inline, $names);
            $mention = $names->names[$id] ?? ($names->handles[$id] ?? $label);

            return match (true) {
                $inline['type'] === 'mention' && is_string($mention) => '@'.$mention,
                $item !== null => "{$item['key']} {$item['title']}",
                $page !== null => $page['title'],
                default => __('richtext.hidden'),
            };
        }

        return match ($inline['type']) {
            'hardBreak' => "\n",
            'mention' => $label === null ? null : '@'.$label,
            'reference' => null,
            'attachment' => (string) $inline['attrs']['filename'],
            default => $inline['text'],
        };
    }

    /**
     * The nodes of these types, in the order of the text.
     *
     * @param  array<string, mixed>  $node
     * @param  list<string>  $types
     * @return list<array<string, mixed>>
     */
    private static function nodesOf(array $node, array $types): array
    {
        $found = in_array($node['type'], $types, true) ? [$node] : [];
        /** @var list<array<string, mixed>> $content */
        $content = $node['content'] ?? [];
        foreach ($content as $child) {
            array_push($found, ...self::nodesOf($child, $types));
        }

        return $found;
    }

    /**
     * @param  list<array<string, mixed>>  $nodes
     * @return list<string>
     */
    private static function ids(array $nodes, string $attribute): array
    {
        return array_values(array_unique(array_map(fn (array $node) => $node['attrs'][$attribute], $nodes)));
    }

    /**
     * @param  array<string, mixed>  $json
     * @return list<string>
     */
    private static function refs(array $json, string $kind): array
    {
        return self::ids(array_values(array_filter(self::nodesOf($json, ['reference']), fn (array $node) => $node['attrs']['kind'] === $kind)), 'id');
    }

    /**
     * The node with `$map` applied to each node of OUTSIDE below it (see withNodes()).
     *
     * @param  array<string, mixed>  $node
     * @param  callable(array<string, mixed>): (array<string, mixed>|string|null)  $map
     * @return array<string, mixed>
     */
    private static function mapped(array $node, callable $map): array
    {
        if (! isset($node['content'])) {
            return $node;
        }
        $content = [];
        /** @var array<string, mixed> $child */
        foreach ($node['content'] as $child) {
            if (! in_array($child['type'], self::OUTSIDE, true)) {
                $content[] = self::mapped($child, $map);

                continue;
            }
            $replaced = $map($child);
            if (is_array($replaced)) {
                $content[] = $replaced;
            } elseif ($replaced !== null && $replaced !== '') {
                $text = ['type' => 'text', 'marks' => $child['marks'] ?? [], 'text' => $replaced];
                $content[] = $child['type'] === 'image' ? ['type' => 'paragraph', 'content' => [$text]] : $text;
            }
        }
        $node['content'] = $content;

        return $node;
    }

    /**
     * The node without the marks of these types.
     *
     * @param  array<string, mixed>  $node
     * @param  list<string>  $types
     * @return array<string, mixed>
     */
    private static function withoutMarks(array $node, array $types): array
    {
        if (isset($node['marks'])) {
            /** @var list<array<string, mixed>> $marks */
            $marks = $node['marks'];
            $node['marks'] = array_values(array_filter($marks, fn (array $mark) => ! in_array($mark['type'], $types, true)));
        }

        return $node;
    }

    /**
     * What a mail shows of a node of OUTSIDE (see toMailHtml()).
     *
     * @param  array<string, mixed>  $node
     * @return array<string, mixed>
     */
    private static function forMail(array $node, RichTextNames $names, string $base): array
    {
        /** @var array<string, mixed> $attrs */
        $attrs = $node['attrs'];
        $id = (string) ($attrs['id'] ?? $attrs['attachmentId']);
        [$item, $page] = self::referred($node, $names);
        // an image is named by its alt text, a file by its file name; without one by its name, else by its ID
        $own = $node['type'] === 'image' ? ($attrs['alt'] ?? null) : ($attrs['filename'] ?? null);
        $file = is_string($own) && $own !== '' ? $own : ($names->names[$id] ?? $id);
        $mention = $names->names[$id] ?? ($names->handles[$id] ?? ($attrs['label'] ?? null));

        return match (true) {
            $node['type'] === 'mention' && is_string($mention) => self::mailText('@'.$mention, $node),
            $item !== null => self::mailText("{$item['key']} {$item['title']}", $node, "{$base}/items/".rawurlencode($item['key'])),
            $page !== null => self::mailText($page['title'], $node, "{$base}/projects/".rawurlencode($page['identifier'])."/wiki/{$id}"),
            $node['type'] === 'image' => ['type' => 'paragraph', 'content' => [self::mailText(__('richtext.image', ['name' => $file]), [], "{$base}/attachments/{$id}")]],
            $node['type'] === 'attachment' => self::mailText($file, $node, "{$base}/attachments/{$id}"),
            default => self::mailText(__('richtext.hidden'), $node),
        };
    }

    /**
     * The item or the page a reference names, as far as the reader sees it: the kind decides where to look, so the name
     * of an item never stands for a page or the other way round. Both `null` for any other node.
     *
     * @param  array<string, mixed>  $node
     * @return array{0: array{key: string, title: string}|null, 1: array{title: string, identifier: string}|null}
     */
    private static function referred(array $node, RichTextNames $names): array
    {
        if ($node['type'] !== 'reference') {
            return [null, null];
        }
        $id = (string) $node['attrs']['id'];

        return $node['attrs']['kind'] === 'page' ? [null, $names->pages[$id] ?? null] : [$names->items[$id] ?? null, null];
    }

    /**
     * A text with the marks of the node it stands for, as a link to `$href` if there is one.
     *
     * @param  array<string, mixed>  $node
     * @return array<string, mixed>
     */
    private static function mailText(string $text, array $node, ?string $href = null): array
    {
        /** @var list<array<string, mixed>> $marks */
        $marks = $node['marks'] ?? [];
        if ($href !== null) {
            $marks = [['type' => 'link', 'attrs' => ['href' => $href]], ...array_filter($marks, fn (array $mark) => $mark['type'] !== 'link')];
        }

        return ['type' => 'text', 'marks' => $marks, 'text' => $text];
    }

    /** @param array<string, mixed> $node */
    private static function hasContent(array $node): bool
    {
        // blanks as the editor's `trim()` knows them (Unicode, NBSP too), not only ASCII
        if (in_array($node['type'], self::CONTENT_ATOMS, true) || preg_match('/^[\s\x{FEFF}]*\z/u', (string) ($node['text'] ?? '')) !== 1) {
            return true;
        }
        /** @var list<array<string, mixed>> $content */
        $content = $node['content'] ?? [];

        return array_any($content, fn (array $child) => self::hasContent($child));
    }

    /** tiptap-php with the nodes of Schema, as the editor renders and parses them. */
    private static function editor(): Editor
    {
        return new Editor(['extensions' => [
            new Nodes\Document,
            new Nodes\Paragraph,
            new Nodes\Text,
            new Nodes\Heading(['levels' => Schema::HEADING_LEVELS]),
            new Nodes\BulletList,
            new Nodes\OrderedList,
            new Nodes\ListItem,
            new Nodes\TaskList,
            self::taskItem(),
            new Nodes\Blockquote,
            new Nodes\CodeBlock,
            new Nodes\HardBreak,
            new Nodes\HorizontalRule,
            new Nodes\Table,
            new Nodes\TableRow,
            new Nodes\TableHeader,
            new Nodes\TableCell,
            new Mention,
            new Reference,
            new AttachmentImage,
            new AttachmentFile,
            new Marks\Bold,
            new Marks\Italic,
            new Marks\Strike,
            self::code(),
            new Marks\Link(['allowedProtocols' => Schema::LINK_PROTOCOLS]),
        ]]);
    }

    /**
     * tiptap-php's code mark, without the `code` of a code block: tiptap-php strips that mark only from code blocks at
     * the top of the document, one in a list or a quote would keep it.
     */
    private static function code(): Mark
    {
        return new class extends Marks\Code
        {
            /** @return list<array<string, mixed>> */
            public function parseHTML(): array
            {
                return [['tag' => 'code', 'getAttrs' => fn (\DOMElement $element) => $element->parentNode?->nodeName === 'pre' ? false : null]];
            }
        };
    }

    /** tiptap-php's task item reads and writes `data-checked` as `true`/`false`, like Tiptap's. */
    private static function taskItem(): Node
    {
        return new class extends Nodes\TaskItem
        {
            /** @return array<string, array<string, mixed>> */
            public function addAttributes(): array
            {
                return ['checked' => [
                    'default' => false,
                    'parseHTML' => fn (\DOMElement $element) => $element->getAttribute('data-checked') === 'true',
                    'renderHTML' => fn (object $attributes) => ['data-checked' => ($attributes->checked ?? false) ? 'true' : 'false'],
                ]];
            }
        };
    }
}
