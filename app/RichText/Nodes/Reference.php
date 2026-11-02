<?php

namespace App\RichText\Nodes;

use Tiptap\Core\Node;

/**
 * A reference to an item (or, from Phase 9, a page) in tiptap-php: `<span data-type="reference" data-id
 * data-kind></span>`, empty and without a key or a title, which only a reader who sees the item may get (K5).
 */
final class Reference extends Node
{
    /** @var string */
    public static $name = 'reference';

    /** @return list<array<string, mixed>> */
    public function parseHTML(): array
    {
        return [['tag' => 'span[data-type="reference"]']];
    }

    /** @return array<string, array<string, mixed>> */
    public function addAttributes(): array
    {
        return [
            'id' => [
                'parseHTML' => fn (\DOMElement $element) => $element->getAttribute('data-id') ?: null,
                'renderHTML' => fn (object $attributes) => ['data-id' => $attributes->id ?? null],
            ],
            'kind' => [
                'parseHTML' => fn (\DOMElement $element) => $element->getAttribute('data-kind') ?: null,
                'renderHTML' => fn (object $attributes) => ['data-kind' => $attributes->kind ?? null],
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
        return ['span', ['data-type' => 'reference', ...$HTMLAttributes], 0];
    }
}
