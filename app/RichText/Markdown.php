<?php

namespace App\RichText;

use App\Domain\Accounts\Handle;
use Dom\Element;
use Dom\HTMLDocument;
use Dom\HTMLElement;
use Dom\Node;
use Dom\Text;
use Dom\XPath;
use League\CommonMark\Event\DocumentParsedEvent;
use League\CommonMark\GithubFlavoredMarkdownConverter;
use League\CommonMark\Node\Block\AbstractBlock;
use League\HTMLToMarkdown\Configuration;
use League\HTMLToMarkdown\ConfigurationAwareInterface;
use League\HTMLToMarkdown\Converter\BlockquoteConverter;
use League\HTMLToMarkdown\Converter\ConverterInterface;
use League\HTMLToMarkdown\Converter\DefaultConverter;
use League\HTMLToMarkdown\Converter\TableConverter;
use League\HTMLToMarkdown\Converter\TextConverter;
use League\HTMLToMarkdown\ElementInterface;
use League\HTMLToMarkdown\HtmlConverter;
use League\HTMLToMarkdown\PreConverterInterface;
use SplStack;

/**
 * Markdown to the HTML tiptap-php parses, and the HTML tiptap-php renders to Markdown. Document is the only caller.
 *
 * Reading is bounded: blocks nest at most Schema::MAX_DEPTH deep (deeper ones stay text), Markdown nested deeper than
 * twice that is refused as `depth` before it is rendered, and HTML with more nodes than a document of
 * Schema::MAX_BYTES can hold is refused as `size` before tiptap-php reads it (Document refuses longer Markdown first).
 *
 * Reading is CommonMark with GitHub's extensions, HTML in the text escaped (it stays text), unsafe links dropped; the
 * HTML is then shaped like the editor's: task lists as `ul[data-type=taskList] > li[data-type=taskItem][data-checked]`,
 * text outside of blocks in paragraphs, headings below Schema::HEADING_LEVELS as paragraphs, soft line breaks as
 * spaces, no closing line break in code. MentionsAndReferences finds mentions, references, images and files; an image
 * is a block, so it splits the paragraph (and the marks) it stands in.
 *
 * Writing is one form for each node, so a document comes back the same from its Markdown:
 * - `#` headings, `-` before list items, `1.` counting from the list's start, `- [x] `/`- [ ] ` for task items; a
 *   list right after a list of its kind with `*` or `1)` (Markdown would join the two), the next one with `-` again;
 * - the lines of an item indented as far as its marker (2 for `- `, 3 for `1. `), a nested list right below its line
 *   (a tight list), a blank line between the blocks of an item;
 * - `**bold**`, `*italic*`, `~~strike~~`, `` `code` ``, `[text](href)` (`<href>` when the text is the address);
 * - code blocks fenced with backticks and the language; a hard break as two spaces at the end of the line;
 * - an item that starts with another block than a paragraph (after the empty one Schema::CONTENT puts first) has the
 *   block on the marker's line (`- - a`, `- # Titel`), a rule there as `***` (`- ---` would be a rule of its own);
 * - `>` before each line of a quote, alone on a blank one;
 * - tables with the first row as the header and `| --- |` below it (Markdown has no table without a header row);
 * - `~` in text escaped, so it never becomes a strike;
 * - a mention as `@` and the reader's handle, a reference to an item the reader sees as its key, one to a page the
 *   reader sees as `[<current title>](page:<ulid>)` (spans()), any other as `[hidden](<kind>:<ulid>)`, a file as
 *   `[name](attachment:<ulid>)`, an image as `![alt](attachment:<ulid>)` on a line of its own; titles, names and alt
 *   texts on one line, escaped like text (label());
 * - text that would read as a mention or a key with a backslash before its `@` or `-` (`\@mara`, `WEB\-47`,
 *   shield()), so only mentions and references come back as nodes; not in code and the text of links, which are never
 *   read for them.
 *
 * What Markdown cannot carry and loses on the way there and back (JSON keeps all of it):
 * - a header column, a table without a header row, a single header cell and a cell spanning rows or columns (a row
 *   with fewer cells is filled with empty ones, cells beyond the header's are dropped); read with the text before,
 *   each table takes the header row and the header column of the one it was if both have as many columns
 *   (TableLayout, A455), single header cells and spans stay lost;
 * - a hard break inside a heading (the heading ends there, the rest becomes a paragraph);
 * - several blocks in a table cell (a list, a code block or a second paragraph flatten into its text);
 * - empty paragraphs (Enter twice in the editor);
 * - in a quote, the blanks of a line that has nothing else and a hard break that starts a paragraph (also inside a
 *   code block in the quote);
 * - a task item whose first paragraph is empty and followed by a block: GitHub's checkbox needs a paragraph, so the
 *   block becomes the text of the item's paragraph (a rule too: `- [ ] ---` is no rule);
 * - a fence's info string that is no language (Schema::LANGUAGE_PATTERN, A150): the code block keeps no language;
 * - the code or link mark of a mention, a reference or a file (Document leaves it out: code and the text of a link are
 *   never read for them, and Markdown has no link inside a link), and the marks inside the name of a file or the alt
 *   text of an image;
 * - a mention or a key next to a letter, a digit, `_` or `-` (`x@mara`, `@maras`, `WEB-47x`): it reads back as text,
 *   as a word of its own would not.
 */
final class Markdown
{
    /** Elements that are blocks of their own; anything else in a container is put into a paragraph. */
    private const BLOCK_TAGS = ['p', 'h1', 'h2', 'h3', 'ul', 'ol', 'pre', 'blockquote', 'hr', 'table', 'img'];

    /** The deepest Markdown: Schema::MAX_DEPTH blocks and as many marks inside of them. */
    private const MAX_MARKDOWN_DEPTH = 2 * Schema::MAX_DEPTH;

    /**
     * The fewest bytes a node takes in a document's JSON: `{"type":"hardBreak"},`. Each element and text of the HTML
     * becomes a node or a mark (which takes as much), except images and links werkbuch drops.
     */
    private const SMALLEST_NODE = 21;

    /** Elements holding blocks. */
    private const CONTAINERS = 'li, blockquote, td, th';

    public static function toHtml(string $markdown, MarkdownContext $ctx): string
    {
        // deeper blocks stay text, so the nesting costs nothing (commonmark recurses without a limit and crashes)
        $converter = new GithubFlavoredMarkdownConverter([
            'html_input' => 'escape',
            'allow_unsafe_links' => false,
            'max_nesting_level' => Schema::MAX_DEPTH,
        ]);
        $converter->getEnvironment()->addEventListener(DocumentParsedEvent::class, self::refuseDeepInlines(...));
        $converter->getEnvironment()->addExtension(new MentionsAndReferences($ctx));
        $html = $converter->convert($markdown);
        $dom = HTMLDocument::createFromString('<!DOCTYPE html><html><body>'.$html.'</body></html>', LIBXML_NOERROR);
        /** @var HTMLElement $body the string above makes one */
        $body = $dom->body;
        $xpath = new XPath($dom);
        $xpath->registerNamespace('h', 'http://www.w3.org/1999/xhtml');
        // tiptap-php reads a long run of nodes in quadratic time (25 s for 130,000); a document of MAX_BYTES holds no
        // more than MAX_BYTES / SMALLEST_NODE of them, so more is too long anyway
        $nodes = 0;
        foreach ($xpath->query('//h:body//node()') as $node) {
            // not the line breaks between blocks
            $nodes += $node instanceof Text && trim($node->data) === '' ? 0 : 1;
        }
        if ($nodes > intdiv(Schema::MAX_BYTES, self::SMALLEST_NODE)) {
            throw new InvalidDocument('size');
        }

        foreach ($dom->querySelectorAll('ul, ol') as $list) {
            self::taskList($list);
        }
        foreach ($dom->querySelectorAll('h4, h5, h6') as $heading) {
            $paragraph = $dom->createElement('p');
            $paragraph->append(...iterator_to_array($heading->childNodes));
            $heading->replaceWith($paragraph);
        }
        foreach ($dom->querySelectorAll('pre > code') as $code) {
            $code->textContent = (string) preg_replace('/\n\z/', '', (string) $code->textContent);
        }
        /** @var Text $text */
        foreach ($xpath->query('//h:body//text()[not(ancestor::h:pre)]') as $text) {
            $data = $text->previousSibling instanceof Element && $text->previousSibling->localName === 'br' ? ltrim($text->data, "\n") : $text->data;
            $text->data = str_replace("\n", ' ', $data);
        }
        foreach ($dom->querySelectorAll('img') as $image) {
            self::hoist($image);
        }
        self::paragraphs($dom, $body);
        foreach ($dom->querySelectorAll(self::CONTAINERS) as $container) {
            self::paragraphs($dom, $container);
        }

        return $body->innerHTML;
    }

    /**
     * A run of `*` nests marks as deep as it is long (50,000 for 100,000 stars), and commonmark's renderer recurses
     * until PHP crashes; Markdown nested deeper than any document could be is refused before it is rendered.
     */
    private static function refuseDeepInlines(DocumentParsedEvent $parsed): void
    {
        // the open nodes as a stack: phpstan stops widening an int counter after a few rounds of the loop
        $open = new SplStack;
        $walker = $parsed->getDocument()->walker();
        while ($event = $walker->next()) {
            // the walker leaves only blocks and nodes with children, as it enters them
            $node = $event->getNode();
            if (! $event->isEntering()) {
                $open->pop();
            } elseif ($node instanceof AbstractBlock || $node->hasChildren()) {
                $open->push($node);
            }
            if ($open->count() > self::MAX_MARKDOWN_DEPTH) {
                throw new InvalidDocument('depth');
            }
        }
    }

    /**
     * An image is a block (Schema::BLOCKS), but Markdown writes it inside a line: it splits the elements around it up
     * to the nearest container (a list item, a quote, a cell, the body), so it stands between the two halves of its
     * paragraph; empty halves go, and the halves lose the blanks next to the image.
     */
    private static function hoist(Element $image): void
    {
        while (($parent = $image->parentElement) !== null && ! $parent->matches(self::CONTAINERS.', body')) {
            /** @var Element $after a shallow copy of an element is an element */
            $after = $parent->cloneNode();
            while ($image->nextSibling !== null) {
                $after->append($image->nextSibling);
            }
            $parent->after($image, $after);
            self::trimEdge($parent, false);
            self::trimEdge($after, true);
            foreach ([$parent, $after] as $half) {
                if ($half->firstElementChild === null && trim((string) $half->textContent) === '') {
                    $half->remove();
                }
            }
        }
    }

    /** Takes the blanks off the first or the last text of an element. */
    private static function trimEdge(Element $element, bool $first): void
    {
        $edge = $first ? $element->firstChild : $element->lastChild;
        while ($edge instanceof Element) {
            $edge = $first ? $edge->firstChild : $edge->lastChild;
        }
        if ($edge instanceof Text) {
            $edge->data = $first ? ltrim($edge->data) : rtrim($edge->data);
        }
    }

    /**
     * Markdown of the HTML Document renders, for a reader: mentions with the handles and references with the keys of
     * `$names` (Document::toMarkdown()).
     */
    public static function fromHtml(string $html, RichTextNames $names = new RichTextNames): string
    {
        $converter = new HtmlConverter([
            'header_style' => 'atx',
            'list_item_style' => '-',
            'strip_tags' => true,
            // the checkbox of a task item; data-checked says the same
            'remove_nodes' => 'label',
            'hard_break' => false,
            'use_autolinks' => true,
        ]);
        $environment = $converter->getEnvironment();
        $environment->addConverter(self::listItems());
        $environment->addConverter(self::strike());
        $environment->addConverter(self::tables());
        $environment->addConverter(self::quotes());
        $environment->addConverter(self::text());
        $environment->addConverter(self::images());
        $environment->addConverter(self::spans($names));

        return $converter->convert($html);
    }

    /**
     * A bullet list of which every item starts with a checkbox becomes a task list; any other checkbox stays as the
     * text it was typed as.
     */
    private static function taskList(Element $list): void
    {
        $items = array_values(array_filter(iterator_to_array($list->childNodes), fn (Node $item) => $item instanceof Element && $item->localName === 'li'));
        $boxes = array_map(self::checkbox(...), $items);
        $tasks = $list->localName === 'ul' && ! in_array(null, $boxes, true);
        if ($tasks) {
            $list->setAttribute('data-type', 'taskList');
        }
        foreach ($items as $index => $item) {
            $box = $boxes[$index];
            if ($box === null) {
                continue;
            }
            $checked = $box->hasAttribute('checked');
            if (! $tasks) {
                $box->replaceWith($checked ? '[x]' : '[ ]');

                continue;
            }
            $item->setAttribute('data-type', 'taskItem');
            $item->setAttribute('data-checked', $checked ? 'true' : 'false');
            $next = $box->nextSibling;
            if ($next instanceof Text) {
                $next->data = ltrim($next->data, ' ');
            }
            $box->remove();
        }
    }

    /**
     * The checkbox GitHub's task lists put first into an item (or into its first paragraph); it never puts one
     * anywhere else.
     */
    private static function checkbox(Element $item): ?Element
    {
        $first = $item->firstElementChild;
        if ($first?->localName === 'p') {
            $first = $first->firstElementChild;
        }

        return $first instanceof Element && $first->localName === 'input' && $first->getAttribute('type') === 'checkbox' ? $first : null;
    }

    /**
     * Puts the text and inline elements between the blocks of a container into paragraphs; an empty quote or cell gets
     * one, and an item that starts with another block an empty one first (Schema::CONTENT: `paragraph block*`), as
     * ProseMirror's DOMParser fills it in.
     */
    private static function paragraphs(HTMLDocument $dom, Element $container): void
    {
        $run = [];
        foreach (iterator_to_array($container->childNodes) as $child) {
            if ($child instanceof Element && in_array($child->localName, self::BLOCK_TAGS, true)) {
                self::paragraph($dom, $container, $run, $child);
                $run = [];
            } else {
                $run[] = $child;
            }
        }
        self::paragraph($dom, $container, $run, null);
        $first = $container->firstElementChild;
        if ($container->localName === 'li' ? $first?->localName !== 'p' : $container->localName !== 'body' && $first === null) {
            $container->insertBefore($dom->createElement('p'), $first);
        }
    }

    /** @param list<Node> $run */
    private static function paragraph(HTMLDocument $dom, Element $container, array $run, ?Element $before): void
    {
        while ($run !== [] && ($edge = $run[0]) instanceof Text && trim($edge->data) === '') {
            array_shift($run);
            $edge->remove();
        }
        while ($run !== [] && ($edge = end($run)) instanceof Text && trim($edge->data) === '') {
            array_pop($run);
            $edge->remove();
        }
        if ($run === []) {
            return;
        }
        if ($run[0] instanceof Text) {
            $run[0]->data = ltrim($run[0]->data);
        }
        $last = end($run);
        if ($last instanceof Text) {
            $last->data = rtrim($last->data);
        }
        $paragraph = $dom->createElement('p');
        $container->insertBefore($paragraph, $before);
        $paragraph->append(...$run);
    }

    /** An image of an attachment: `![alt](attachment:<ulid>)`, a block of its own. */
    private static function images(): ConverterInterface
    {
        return new class implements ConverterInterface
        {
            public function convert(ElementInterface $element): string
            {
                return '!['.Markdown::label($element->getAttribute('alt')).'](attachment:'.$element->getAttribute('data-attachment-id').")\n\n";
            }

            public function getSupportedTags(): array
            {
                return ['img'];
            }
        };
    }

    /**
     * The empty elements of the inline nodes: a mention as `@` and the reader's handle for it (else its label, if that
     * is a handle; else nothing), a reference to an item the reader sees as its key, one to a page the reader sees as
     * `[<title>](page:<ulid>)`, any other as `[hidden](<kind>:<ulid>)` (the kind decides which names count), a file as
     * `[name](attachment:<ulid>)`; any other span as league writes it. Mentions and keys go out as they are, so they
     * read back as nodes, while text that looks like them is shielded (text()).
     */
    private static function spans(RichTextNames $names): ConverterInterface
    {
        return new class($names) implements ConfigurationAwareInterface, ConverterInterface
        {
            private DefaultConverter $other;

            public function __construct(private readonly RichTextNames $names)
            {
                $this->other = new DefaultConverter;
            }

            public function setConfig(Configuration $config): void
            {
                $this->other->setConfig($config);
            }

            public function convert(ElementInterface $element): string
            {
                $id = $element->getAttribute('data-id');
                $label = $element->getAttribute('data-label');
                $handle = $this->names->handles[$id] ?? (Handle::isValid($label) ? $label : null);

                return match ($element->getAttribute('data-type')) {
                    'mention' => $handle === null ? '' : '@'.$handle,
                    'reference' => $this->reference($element->getAttribute('data-kind'), $id),
                    'attachment' => '['.Markdown::label($element->getAttribute('data-filename')).'](attachment:'.$element->getAttribute('data-attachment-id').')',
                    default => $this->other->convert($element),
                };
            }

            private function reference(string $kind, string $id): string
            {
                $page = $kind === 'page' ? $this->names->pages[$id] ?? null : null;
                $item = $kind === 'item' ? $this->names->items[$id] ?? null : null;

                return match (true) {
                    $item !== null => $item['key'],
                    $page !== null => '['.Markdown::label($page['title']).'](page:'.$id.')',
                    default => "[hidden]({$kind}:{$id})",
                };
            }

            public function getSupportedTags(): array
            {
                return ['span'];
            }
        };
    }

    /**
     * A file name or an alt text as the text of a link: on one line, with the characters escaped that would end the
     * link, make marks or HTML of it (`&` only where it would start an entity), the way text() escapes text.
     *
     * @internal for the converters of this class
     */
    public static function label(string $text): string
    {
        $text = (string) preg_replace('/[\\\\`*_~\[\]|<>]/', '\\\\$0', (string) preg_replace('/\s+/u', ' ', $text));

        return (string) preg_replace('/&(?=#?[A-Za-z0-9]+;)/', '\\\\&', $text);
    }

    /**
     * Text that MentionsAndReferences would read as a mention or a key, with a backslash before the `@` or the `-`
     * (`\@mara`, `WEB\-47`), so it reads back as the text it is. The same pattern as reading, on each text alone: a
     * text never reads as a larger piece than it is written in.
     *
     * @internal for the converters of this class
     */
    public static function shield(string $text): string
    {
        return (string) preg_replace_callback(
            MentionsAndReferences::words(),
            fn (array $word) => str_starts_with($word[0], '@') ? '\\'.$word[0] : str_replace('-', '\\-', $word[0]),
            $text,
        );
    }

    private static function listItems(): ConverterInterface
    {
        return new class implements ConverterInterface
        {
            public function convert(ElementInterface $element): string
            {
                /** @var ElementInterface $list an item's list */
                $list = $element->getParent();
                // a list right after one of its kind takes the other marker, or Markdown would join the two (the
                // block before is Markdown already)
                $before = ltrim($list->getPreviousSibling()?->getValue() ?? '');
                $marker = str_starts_with($before, '- ') ? '* ' : '- ';
                if ($list->getTagName() === 'ol') {
                    $start = $list->getAttribute('start');
                    $number = (is_numeric($start) ? (int) $start : 1) + $element->getSiblingPosition() - 1;
                    $marker = $number.(preg_match('/\A\d+\. /', $before) === 1 ? ') ' : '. ');
                }
                $task = match ($element->getAttribute('data-type') === 'taskItem' ? $element->getAttribute('data-checked') : null) {
                    'true' => '[x] ',
                    'false' => '[ ] ',
                    default => '',
                };
                // a nested list right below the line of its item; the item's other lines as far in as its marker
                $value = (string) preg_replace('/\n{2,}(?=(?:[-*]|\d+[.)]) )/', "\n", trim($element->getValue()));
                $value = (string) preg_replace('/\n(?!\n)/', "\n".str_repeat(' ', strlen($marker)), $value);
                // a rule that starts the item (after its empty paragraph): `- ---` would be a rule of its own
                if ($marker.$task === '- ' && preg_match('/\A---(?:\n|\z)/', $value) === 1) {
                    $value = '***'.substr($value, 3);
                }
                $first = $element->getListItemLevel() > 0 && $element->getSiblingPosition() === 1;

                return ($first ? "\n" : '').rtrim($marker.$task.$value, ' ')."\n";
            }

            public function getSupportedTags(): array
            {
                return ['li'];
            }
        };
    }

    private static function strike(): ConverterInterface
    {
        return new class implements ConverterInterface
        {
            public function convert(ElementInterface $element): string
            {
                // spaces at the edges stay outside the delimiters, or they would not close
                $value = $element->getValue();
                $core = trim($value);
                $lead = strlen($value) - strlen(ltrim($value));

                return $core === '' ? $value : substr($value, 0, $lead).'~~'.$core.'~~'.substr($value, $lead + strlen($core));
            }

            public function getSupportedTags(): array
            {
                return ['s'];
            }
        };
    }

    /** league's tables, with spaces in the row below the header: `| --- | --- |`. */
    private static function tables(): ConverterInterface
    {
        return new class implements ConfigurationAwareInterface, ConverterInterface, PreConverterInterface
        {
            private TableConverter $tables;

            public function __construct()
            {
                $this->tables = new TableConverter;
            }

            public function setConfig(Configuration $config): void
            {
                $this->tables->setConfig($config);
            }

            public function preConvert(ElementInterface $element): void
            {
                $this->tables->preConvert($element);
            }

            public function convert(ElementInterface $element): string
            {
                return (string) preg_replace_callback(
                    '/^\|((?:---\|)+)$/m',
                    fn (array $row) => '| '.implode(' | ', array_filter(explode('|', $row[1]))).' |',
                    $this->tables->convert($element),
                );
            }

            public function getSupportedTags(): array
            {
                return $this->tables->getSupportedTags();
            }
        };
    }

    /** league's quotes, without the space after `>` on a blank line. */
    private static function quotes(): ConverterInterface
    {
        return new class implements ConverterInterface
        {
            public function convert(ElementInterface $element): string
            {
                return (string) preg_replace('/^(>[> ]*?) +$/m', '$1', (new BlockquoteConverter)->convert($element));
            }

            public function getSupportedTags(): array
            {
                return ['blockquote'];
            }
        };
    }

    /**
     * league's text, with `~` escaped (it would make a strike of the text) and `<`, `>` escaped with a backslash instead
     * of as entities; `&` only where it would start an entity; outside of links, what would read as a mention or a key
     * shielded (shield()).
     */
    private static function text(): ConverterInterface
    {
        return new class implements ConverterInterface
        {
            public function convert(ElementInterface $element): string
            {
                $text = str_replace(['~', '&lt;', '&gt;'], ['\\~', '\\<', '\\>'], (new TextConverter)->convert($element));
                $text = (string) preg_replace_callback('/&amp;(#?[A-Za-z0-9]+;)?/', fn (array $amp) => isset($amp[1]) ? '\\&'.$amp[1] : '&', $text);

                // the text of a link is never read for mentions and keys (code never reaches this)
                return $element->isDescendantOf('a') ? $text : Markdown::shield($text);
            }

            public function getSupportedTags(): array
            {
                return ['#text'];
            }
        };
    }
}
