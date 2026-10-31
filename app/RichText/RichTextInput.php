<?php

namespace App\RichText;

use Illuminate\Validation\ValidationException;

/**
 * A rich text field of an input: `<field>` as Markdown (REST, MCP) or `<field>_json` as Tiptap JSON (the editor),
 * never both. `null`, `''` and an empty document clear the field.
 */
final class RichTextInput
{
    /**
     * Whether the input sends the field in either form (a PATCH changes only what it sends).
     *
     * @param  array<string, mixed>  $input
     */
    public static function given(array $input, string $field): bool
    {
        return array_key_exists($field, $input) || array_key_exists("{$field}_json", $input);
    }

    /**
     * The document of the field, `null` to clear it or when the input does not send it (ask given() first). A
     * document werkbuch does not take is a 422 at the key that sent it.
     *
     * @param  array<string, mixed>  $input
     *
     * @throws ValidationException
     */
    public static function from(array $input, string $field, MarkdownContext $ctx): ?Document
    {
        $key = "{$field}_json";
        if (array_key_exists($field, $input) && array_key_exists($key, $input)) {
            throw ValidationException::withMessages([$field => __('field.rich_text.both')]);
        }
        $markdown = array_key_exists($field, $input);
        $value = $markdown ? $input[$field] : ($input[$key] ?? null);
        if ($value === null || $value === '') {
            return null;
        }
        $key = $markdown ? $field : $key;
        try {
            $document = match (true) {
                $markdown && is_string($value) => Document::fromMarkdown($value, $ctx),
                ! $markdown && is_array($value) => Document::fromJson($value),
                default => throw new InvalidDocument('shape'),
            };
        } catch (InvalidDocument $invalid) {
            $message = $invalid->reason === 'size' ? __('field.rich_text.too_long') : __('field.rich_text.invalid');

            throw ValidationException::withMessages([$key => $message]);
        }

        return $document->isEmpty() ? null : $document;
    }
}
