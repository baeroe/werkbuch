<?php

namespace App\RichText;

use Dom\Element;
use Dom\HTMLDocument;
use Dom\HTMLElement;
use Dom\Node;
use Dom\Text;
use Dom\XPath;
use League\CommonMark\GithubFlavoredMarkdownConverter;
use League\HTMLToMarkdown\Configuration;
use League\HTMLToMarkdown\ConfigurationAwareInterface;
use League\HTMLToMarkdown\Converter\ConverterInterface;
use League\HTMLToMarkdown\Converter\TableConverter;
use League\HTMLToMarkdown\Converter\TextConverter;
use League\HTMLToMarkdown\ElementInterface;
use League\HTMLToMarkdown\HtmlConverter;
use League\HTMLToMarkdown\PreConverterInterface;

/**
 * Markdown to the HTML tiptap-php parses, and the HTML tiptap-php renders to Markdown. Document is the only caller.
 *
 * Reading is CommonMark with GitHub's extensions, HTML in the text escaped (it stays text), unsafe links dropped; the
 * HTML is then shaped like the editor's: task lists as `ul[data-type=taskList] > li[data-type=taskItem][data-checked]`,
 * text outside of blocks in paragraphs, headings below Schema::HEADING_LEVELS as paragraphs, soft line breaks as
 * spaces, no closing line break in code.
 *
 * Writing is one form for each node, so a document comes back the same from its Markdown:
 * - `#` headings, `-` before list items, `1.` counting from the list's start, `- [x] `/`- [ ] ` for task items; a
 *   list right after a list of its kind with `*` or `1)` (Markdown would join the two), the next one with `-` again;
 * - the lines of an item indented as far as its marker (2 for `- `, 3 for `1. `), a nested list right below its line
 *   (a tight list), a blank line between the blocks of an item;
 * - `**bold**`, `*italic*`, `~~strike~~`, `` `code` ``, `[text](href)` (`<href>` when the text is the address);
 * - code blocks fenced with backticks and the language; a hard break as two spaces at the end of the line;
 * - tables with the first row as the header and `| --- |` below it (Markdown has no table without a header row);
 * - `~` in text escaped, so it never becomes a strike.
 */
final class Markdown
{
    /** Elements that are blocks of their own; anything else in a container is put into a paragraph. */
    private const BLOCK_TAGS = ['p', 'h1', 'h2', 'h3', 'ul', 'ol', 'pre', 'blockquote', 'hr', 'table'];

    /** Elements holding blocks. */
    private const CONTAINERS = 'li, blockquote, td, th';

    public static function toHtml(string $markdown): string
    {
        $html = (new GithubFlavoredMarkdownConverter(['html_input' => 'escape', 'allow_unsafe_links' => false]))->convert($markdown);
        $dom = HTMLDocument::createFromString('<!DOCTYPE html><html><body>'.$html.'</body></html>', LIBXML_NOERROR);
        /** @var HTMLElement $body the string above makes one */
        $body = $dom->body;

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
        $xpath = new XPath($dom);
        $xpath->registerNamespace('h', 'http://www.w3.org/1999/xhtml');
        /** @var Text $text */
        foreach ($xpath->query('//h:body//text()[not(ancestor::h:pre)]') as $text) {
            $data = $text->previousSibling instanceof Element && $text->previousSibling->localName === 'br' ? ltrim($text->data, "\n") : $text->data;
            $text->data = str_replace("\n", ' ', $data);
        }
        self::paragraphs($dom, $body);
        foreach ($dom->querySelectorAll(self::CONTAINERS) as $container) {
            self::paragraphs($dom, $container);
        }

        return $body->innerHTML;
    }

    public static function fromHtml(string $html): string
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
        $environment->addConverter(self::text());

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

    /** Puts the text and inline elements between the blocks of a container into paragraphs; an empty item or cell gets one. */
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
        if ($container->localName !== 'body' && $container->firstElementChild === null) {
            $container->append($dom->createElement('p'));
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

    /**
     * league's text, with `~` escaped (it would make a strike of the text) and `<`, `>` escaped with a backslash instead
     * of as entities; `&` only where it would start an entity.
     */
    private static function text(): ConverterInterface
    {
        return new class implements ConverterInterface
        {
            public function convert(ElementInterface $element): string
            {
                $text = str_replace(['~', '&lt;', '&gt;'], ['\\~', '\\<', '\\>'], (new TextConverter)->convert($element));

                return (string) preg_replace_callback('/&amp;(#?[A-Za-z0-9]+;)?/', fn (array $amp) => isset($amp[1]) ? '\\&'.$amp[1] : '&', $text);
            }

            public function getSupportedTags(): array
            {
                return ['#text'];
            }
        };
    }
}
