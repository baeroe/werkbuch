<?php

namespace App\RichText\Nodes;

use Tiptap\Core\Node;

/**
 * An uploaded file in a line of text, in tiptap-php: `<span data-type="attachment" data-attachment-id
 * data-filename></span>`, empty, the file name in an attribute (escaped there), never as text (K5).
 */
final class AttachmentFile extends Node
{
    /** @var string */
    public static $name = 'attachment';

    /** @return list<array<string, mixed>> */
    public function parseHTML(): array
    {
        return [['tag' => 'span[data-type="attachment"]']];
    }

    /** @return array<string, array<string, mixed>> */
    public function addAttributes(): array
    {
        return [
            'attachmentId' => [
                'parseHTML' => fn (\DOMElement $element) => Attribute::of($element, 'data-attachment-id'),
                'renderHTML' => fn (object $attributes) => ['data-attachment-id' => $attributes->attachmentId ?? null],
            ],
            'filename' => [
                'parseHTML' => fn (\DOMElement $element) => Attribute::of($element, 'data-filename'),
                'renderHTML' => fn (object $attributes) => ['data-filename' => $attributes->filename ?? null],
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
        return ['span', ['data-type' => 'attachment', ...$HTMLAttributes], 0];
    }
}
