<?php

namespace App\RichText;

use Tiptap\Core\Mark;
use Tiptap\Core\Node;
use Tiptap\Editor;
use Tiptap\Marks;
use Tiptap\Nodes;

/**
 * A rich text as werkbuch stores it: Tiptap JSON of the standard nodes (Schema), the form the editor sends. It reads
 * and writes Markdown (REST, MCP), plain text (search, `description_text`) and HTML (Phase 7 builds mails from it).
 * Nothing a user typed as HTML is ever output as HTML: Markdown reads HTML as text, and the HTML comes from the nodes.
 */
final class Document
{
    private const JSON_FLAGS = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE;

    /** Nodes that are content on their own, without any text (`isEmptyDoc` in the editor). */
    private const CONTENT_ATOMS = ['horizontalRule', 'table'];

    /** Nodes whose text makes one line of `toText()`. */
    private const TEXT_BLOCKS = ['paragraph', 'heading', 'codeBlock'];

    /** @param array<string, mixed> $json */
    private function __construct(private readonly array $json) {}

    /**
     * Reads a document the way the editor's schema does: missing attributes take their default, unknown attributes
     * are dropped, a link to anything but Schema::LINK_PROTOCOLS loses its mark and keeps its text, an odd value of a
     * lenient attribute (Schema::LENIENT: list start, cell spans and widths, code language) takes its default.
     * Everything else that does not fit is refused.
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
        $html = Markdown::toHtml($markdown);
        // tiptap-php cannot read an empty body
        $json = $html === '' ? ['type' => 'doc'] : self::editor()->setContent($html)->getDocument();

        return self::fromJson(is_array($json) ? $json : []);
    }

    /** @return array<string, mixed> */
    public function toJson(): array
    {
        return $this->json;
    }

    /** The document as Markdown; Markdown::fromHtml() lists how it is written. */
    public function toMarkdown(): string
    {
        return Markdown::fromHtml($this->toHtml());
    }

    /** The text without any markup: one line per paragraph, heading or code block, a line break as a line break. */
    public function toText(): string
    {
        $lines = [];
        self::lines($this->json, $lines);

        return implode("\n", array_filter($lines, fn (string $line) => trim($line) !== ''));
    }

    public function toHtml(): string
    {
        // tiptap-php cannot render a doc without content
        return isset($this->json['content']) ? self::editor()->setContent($this->json)->getHTML() : '';
    }

    /** Whether the document holds nothing: no text but blanks, no rule and no table (an emptied editor). */
    public function isEmpty(): bool
    {
        return ! self::hasContent($this->json);
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
        $allowed = $type === 'text' ? ['type', 'marks', 'text'] : ['type', 'attrs', 'content'];
        if (array_diff(array_keys($node), $allowed) !== []) {
            throw new InvalidDocument('shape');
        }
        $read = ['type' => $type];
        if (isset(Schema::ATTRS[$type])) {
            $read['attrs'] = self::attrs($node['attrs'] ?? [], Schema::ATTRS[$type]);
        }
        $content = self::list($node['content'] ?? []);
        if ($content !== []) {
            $read['content'] = array_map(fn (mixed $child) => self::child($child, $type, $depth + 1), $content);
        }
        if ($type !== 'text') {
            return $read;
        }
        $marks = self::marks(self::list($node['marks'] ?? []));
        if ($marks !== []) {
            $read['marks'] = $marks;
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

        return $read;
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
            $attrs[$name] = $value;
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
    private static function lines(array $node, array &$lines): void
    {
        /** @var list<array<string, mixed>> $content */
        $content = $node['content'] ?? [];
        if (in_array($node['type'], self::TEXT_BLOCKS, true)) {
            $lines[] = implode('', array_map(fn (array $inline) => $inline['type'] === 'hardBreak' ? "\n" : $inline['text'], $content));

            return;
        }
        foreach ($content as $child) {
            self::lines($child, $lines);
        }
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
