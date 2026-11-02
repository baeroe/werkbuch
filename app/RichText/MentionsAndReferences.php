<?php

namespace App\RichText;

use App\Domain\Accounts\Handle;
use App\Domain\Ulid;
use App\Domain\WorkItems\ItemKey;
use League\CommonMark\Environment\EnvironmentBuilderInterface;
use League\CommonMark\Event\DocumentParsedEvent;
use League\CommonMark\Extension\CommonMark\Node\Inline\Image;
use League\CommonMark\Extension\CommonMark\Node\Inline\Link;
use League\CommonMark\Extension\ExtensionInterface;
use League\CommonMark\Node\Inline\AbstractStringContainer;
use League\CommonMark\Node\Inline\Newline;
use League\CommonMark\Node\Inline\Text;
use League\CommonMark\Node\Node;
use League\CommonMark\Parser\Inline\InlineParserInterface;
use League\CommonMark\Parser\Inline\InlineParserMatch;
use League\CommonMark\Parser\InlineParserContext;
use League\CommonMark\Renderer\ChildNodeRendererInterface;
use League\CommonMark\Renderer\NodeRendererInterface;
use League\CommonMark\Util\HtmlElement;
use League\CommonMark\Util\Xml;

/**
 * Finds the nodes of Phase 7 in Markdown (spec 4.16) once commonmark has parsed it, and renders them as the empty
 * elements tiptap-php reads (App\RichText\Nodes, K5):
 * - `@handle` (no word character before the `@`, Handle::PATTERN, none after) is a mention if the lookup says the text
 *   may mention the account, or if the text mentioned it before (MarkdownContext::$keptMentions, K8);
 * - a key (ItemKey::PATTERN as a word of its own: no word character and no `-` before or after) is a reference if the
 *   lookup names an item the writer sees; the key of any other item stays text, so a key never tells whether its item
 *   exists;
 * - `[text](item:<ulid>)` is a reference if the writer sees the item or the text referred to it before
 *   (MarkdownContext::$keptRefs); otherwise its text stays;
 * - `![alt](attachment:<ulid>)` is an image and `[name](attachment:<ulid>)` a file, whose attachment the rules check
 *   when the text is saved; an image from anywhere else is no node, its alt text stays as text (P5).
 *
 * Without a lookup, mentions and keys stay text and an `item:` link becomes a reference only when it was kept. Nothing
 * in code or the text of a link or an image (autolinks too) is read, and `page:` links stay text until Phase 9. HTML
 * in Markdown is text (`html_input: escape`): a `@handle` between two tags is read like any other text.
 *
 * `\@` and `\-` are text that is never part of a mention or a key (EscapedCharacter): `\@mara`, `WEB\-47`. Markdown
 * writes text that would read as a mention or a key that way (Markdown::shield()), so text stays text and only the
 * nodes come back as nodes.
 */
final class MentionsAndReferences implements ExtensionInterface, InlineParserInterface, NodeRendererInterface
{
    /**
     * Where a `@handle` or a key is no mention and no reference. Code and HTML hold their text as a literal of their
     * own, never as Text, so they need no entry.
     */
    private const SHELTERS = [Link::class, Image::class];

    public function __construct(private readonly MarkdownContext $ctx) {}

    public function register(EnvironmentBuilderInterface $environment): void
    {
        // after the parsers, autolinks included, and after the listeners registered before it
        $environment->addEventListener(DocumentParsedEvent::class, $this->resolve(...), 0);
        // before commonmark's backslash escapes (80), which would join the character with the text around it
        $environment->addInlineParser($this, 90);
        $environment->addRenderer(MarkdownAtom::class, $this);
        $environment->addRenderer(EscapedCharacter::class, $this);
    }

    public function getMatchDefinition(): InlineParserMatch
    {
        return InlineParserMatch::oneOf('\\@', '\\-');
    }

    public function parse(InlineParserContext $inlineContext): bool
    {
        $inlineContext->getContainer()->appendChild(new EscapedCharacter(substr($inlineContext->getFullMatch(), 1)));
        $inlineContext->getCursor()->advanceBy(2);

        return true;
    }

    public function render(Node $node, ChildNodeRendererInterface $childRenderer): HtmlElement|string
    {
        if ($node instanceof EscapedCharacter) {
            return Xml::escape($node->getLiteral());
        }
        MarkdownAtom::assertInstanceOf($node);
        /** @var MarkdownAtom $node checked above; commonmark only hands it the nodes it was registered for */

        // commonmark escapes the attributes; the element stays empty, so tiptap-php gives the node no content
        return new HtmlElement($node->tag, $node->attributes, '', $node->tag === 'img');
    }

    private function resolve(DocumentParsedEvent $parsed): void
    {
        // collected first: replacing nodes while walking would skip some
        $texts = $images = $links = [];
        $walker = $parsed->getDocument()->walker();
        while ($event = $walker->next()) {
            $node = $event->getNode();
            match (true) {
                $node instanceof Text => $texts[] = $node,
                $node instanceof Image && $event->isEntering() => $images[] = $node,
                $node instanceof Link && $event->isEntering() => $links[] = $node,
                default => null,
            };
        }
        $words = $this->ctx->lookup === null ? [] : array_map(self::wordsOf(...), $texts);
        $this->prepare($words, $links);
        foreach ($texts as $index => $text) {
            $this->text($text, $words[$index] ?? []);
        }
        foreach ($images as $image) {
            self::image($image);
        }
        foreach ($links as $link) {
            $this->link($link);
        }
    }

    /**
     * Tells the lookup every handle, key and `item:` link of the text at once (each once), so it asks the database
     * a few times for the whole text, never once per word.
     *
     * @param  list<list<array{0: string, 1: int}>>  $words
     * @param  list<Link>  $links
     */
    private function prepare(array $words, array $links): void
    {
        if ($this->ctx->lookup === null) {
            return;
        }
        $handles = $keys = [];
        foreach (array_merge([], ...$words) as [$word]) {
            if (str_starts_with($word, '@')) {
                $handles[substr($word, 1)] = true;
            } elseif (($key = ItemKey::parse($word)) !== null) {
                $keys["{$key['identifier']}-{$key['number']}"] = true;
            }
        }
        $items = array_values(array_unique(array_filter(array_map(fn (Link $link) => self::target($link->getUrl(), 'item'), $links))));
        $this->ctx->lookup->prepare(array_map(strval(...), array_keys($handles)), array_map(strval(...), array_keys($keys)), $items);
    }

    /**
     * The handles after an `@` and the keys of a text with their offsets; none in code or the text of a link or an
     * image.
     *
     * @return list<array{0: string, 1: int}>
     */
    private static function wordsOf(Text $text): array
    {
        if (self::sheltered($text)) {
            return [];
        }
        preg_match_all(self::words(), $text->getLiteral(), $matches, PREG_SET_ORDER | PREG_OFFSET_CAPTURE);

        return array_map(fn (array $match) => $match[0], $matches);
    }

    /** @param list<array{0: string, 1: int}> $words */
    private function text(Text $text, array $words): void
    {
        $lookup = $this->ctx->lookup;
        if ($words === [] || $lookup === null) {
            return;
        }
        $literal = $text->getLiteral();
        $nodes = [];
        $at = 0;
        foreach ($words as [$word, $offset]) {
            $atom = str_starts_with($word, '@') ? $this->mention($lookup, substr($word, 1)) : self::key($lookup, $word);
            if ($atom === null) {
                continue;
            }
            if ($offset > $at) {
                $nodes[] = new Text(substr($literal, $at, $offset - $at));
            }
            $nodes[] = $atom;
            $at = $offset + strlen($word);
        }
        if ($nodes === []) {
            return;
        }
        if ($at < strlen($literal)) {
            $nodes[] = new Text(substr($literal, $at));
        }
        foreach ($nodes as $node) {
            $text->insertBefore($node);
        }
        $text->detach();
    }

    private function mention(RichTextLookup $lookup, string $handle): ?MarkdownAtom
    {
        $account = $lookup->mentionable($handle);
        if ($account === null) {
            $known = $lookup->account($handle);
            $account = $known !== null && in_array(strtolower($known['id']), $this->ctx->keptMentions, true) ? $known : null;
        }

        return $account === null ? null : new MarkdownAtom('span', ['data-type' => 'mention', 'data-id' => $account['id'], 'data-label' => $account['handle']]);
    }

    private static function key(RichTextLookup $lookup, string $word): ?MarkdownAtom
    {
        $key = ItemKey::parse($word);
        $id = $key === null ? null : $lookup->visibleItemByKey("{$key['identifier']}-{$key['number']}");

        return $id === null ? null : self::reference($id);
    }

    private function link(Link $link): void
    {
        $id = self::target($link->getUrl(), 'item');
        if ($id !== null && (($this->ctx->lookup?->visibleItem($id) ?? false) || in_array($id, $this->ctx->keptRefs, true))) {
            $link->replaceWith(self::reference($id));

            return;
        }
        $id = self::target($link->getUrl(), 'attachment');
        if ($id !== null) {
            $link->replaceWith(new MarkdownAtom('span', ['data-type' => 'attachment', 'data-attachment-id' => $id, 'data-filename' => self::plain($link)]));
        }
    }

    private static function image(Image $image): void
    {
        $id = self::target($image->getUrl(), 'attachment');
        if ($id !== null) {
            $image->replaceWith(new MarkdownAtom('img', ['data-attachment-id' => $id, 'alt' => self::plain($image)]));

            return;
        }
        foreach (iterator_to_array($image->children(), false) as $child) {
            $image->insertBefore($child);
        }
        $image->detach();
    }

    private static function reference(string $id): MarkdownAtom
    {
        return new MarkdownAtom('span', ['data-type' => 'reference', 'data-id' => $id, 'data-kind' => 'item']);
    }

    /** The ULID of a `<scheme>:<ulid>` address, in lower case; null for any other address. */
    private static function target(string $url, string $scheme): ?string
    {
        return preg_match("/\\A{$scheme}:(\\w{26})\\z/i", $url, $match) === 1 && Ulid::is($match[1]) ? strtolower($match[1]) : null;
    }

    /** The text of a link or an image, without its marks; a line break as a space. */
    private static function plain(Node $node): string
    {
        $plain = '';
        $walker = $node->walker();
        while ($event = $walker->next()) {
            $child = $event->getNode();
            $plain .= match (true) {
                $child instanceof AbstractStringContainer => $child->getLiteral(),
                $child instanceof Newline => ' ',
                default => '',
            };
        }

        return $plain;
    }

    private static function sheltered(Node $node): bool
    {
        for ($parent = $node->parent(); $parent !== null; $parent = $parent->parent()) {
            if (array_any(self::SHELTERS, fn (string $class) => $parent instanceof $class)) {
                return true;
            }
        }

        return false;
    }

    /** A handle after an `@` or a key, each as a word of its own: Handle::PATTERN and ItemKey::PATTERN without anchors. */
    public static function words(): string
    {
        $bare = fn (string $pattern) => substr($pattern, strlen('/^'), -strlen('\z/'));

        return '/(?<!\w)@'.$bare(Handle::PATTERN).'(?![\w-])|(?<![\w-])'.$bare(ItemKey::PATTERN).'(?![\w-])/u';
    }
}
