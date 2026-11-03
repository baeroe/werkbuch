<?php

namespace App\RichText\Nodes;

use Tiptap\Core\Node;

/**
 * An uploaded image in tiptap-php: `<img data-attachment-id alt>` without a `src`, so the HTML never names a path; the
 * page or the mail builds the address from the ID. Only an `img[data-attachment-id]` is read: an `img[src]` (an image
 * from somewhere else) becomes no node.
 */
final class AttachmentImage extends Node
{
    /** @var string */
    public static $name = 'image';

    /** @return list<array<string, mixed>> */
    public function parseHTML(): array
    {
        return [['tag' => 'img[data-attachment-id]']];
    }

    /** @return array<string, array<string, mixed>> */
    public function addAttributes(): array
    {
        return [
            'attachmentId' => [
                'parseHTML' => fn (\DOMElement $element) => Attribute::of($element, 'data-attachment-id'),
                'renderHTML' => fn (object $attributes) => ['data-attachment-id' => $attributes->attachmentId ?? null],
            ],
            'alt' => [
                'parseHTML' => fn (\DOMElement $element) => Attribute::of($element, 'alt'),
                'renderHTML' => fn (object $attributes) => ['alt' => $attributes->alt ?? null],
            ],
        ];
    }

    public function renderText(mixed $node): string
    {
        return '';
    }

    /**
     * @param  array<string, mixed>  $HTMLAttributes
     * @return array{0: string, 1: array<string, mixed>}
     */
    public function renderHTML(mixed $node, mixed $HTMLAttributes = []): array
    {
        return ['img', $HTMLAttributes];
    }
}
