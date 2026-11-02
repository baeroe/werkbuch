<?php

namespace App\RichText\Nodes;

use Tiptap\Core\Node;

/**
 * A mention in tiptap-php: `<span data-type="mention" data-id data-label></span>`, an empty element with the handle in
 * an attribute (escaped there), never as text: tiptap-php writes `renderText()` unescaped. Not tiptap-php's Mention,
 * which reads and writes `self::$name` and so cannot be told apart from a reference (K5).
 */
final class Mention extends Node
{
    /** @var string */
    public static $name = 'mention';

    /** @return list<array<string, mixed>> */
    public function parseHTML(): array
    {
        return [['tag' => 'span[data-type="mention"]']];
    }

    /** @return array<string, array<string, mixed>> */
    public function addAttributes(): array
    {
        return [
            'id' => [
                'parseHTML' => fn (\DOMElement $element) => $element->getAttribute('data-id') ?: null,
                'renderHTML' => fn (object $attributes) => ['data-id' => $attributes->id ?? null],
            ],
            'label' => [
                'parseHTML' => fn (\DOMElement $element) => $element->getAttribute('data-label') ?: null,
                'renderHTML' => fn (object $attributes) => ['data-label' => $attributes->label ?? null],
            ],
        ];
    }

    public function renderText(mixed $node): string
    {
        return '';
    }

    /**
     * @param  array<string, mixed>  $HTMLAttributes
     * @return array{0: string, 1: array<string, mixed>, 2: int}
     */
    public function renderHTML(mixed $node, mixed $HTMLAttributes = []): array
    {
        return ['span', ['data-type' => 'mention', ...$HTMLAttributes], 0];
    }
}
