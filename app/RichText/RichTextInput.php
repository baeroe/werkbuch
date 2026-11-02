<?php

namespace App\RichText;

use App\Support\RichTextRules;
use Illuminate\Validation\ValidationException;

/**
 * A rich text field of an input: `<field>` as Markdown (REST, MCP) or `<field>_json` as Tiptap JSON (the editor),
 * never both. `null`, `''` and an empty document clear the field. With a project and a writer in the context, the
 * rules of saving (RichTextRules) run on what was read, JSON and Markdown alike.
 */
final class RichTextInput
{
    /**
     * Request keys (dotted, `Str::is`) whose strings TrimStrings and ConvertEmptyStringsToNull leave alone: the text
     * nodes of a document in `<field>_json` and of a rich text value in `values.<property>` (also nested, as in a bulk
     * patch). Trimming would eat the space between two marks.
     */
    public const RAW_KEYS = ['*_json.*', '*values.*.content.*'];

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
     * document werkbuch does not take is a 422 at the key that sent it, and so is what the rules of saving refuse; a
     * text that is empty after the rules clears the field.
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
            $document = self::ruled($document, $ctx, $key, is_array($value) ? self::referenceLabels($value) : []);
        } catch (InvalidDocument $invalid) {
            $message = $invalid->reason === 'size' ? __('field.rich_text.too_long') : __('field.rich_text.invalid');

            throw ValidationException::withMessages([$key => $message]);
        }

        return $document->isEmpty() ? null : $document;
    }

    /**
     * The document after the rules of saving, when the context names a project and a writer (RichTextRules::context()).
     *
     * @param  array<string, string>  $labels
     *
     * @throws ValidationException
     * @throws InvalidDocument
     */
    public static function ruled(Document $document, MarkdownContext $ctx, string $key, array $labels): Document
    {
        return $ctx->project === null || $ctx->writer === null
            ? $document
            : RichTextRules::apply($document, $ctx->project, $ctx->writer, $ctx->before, $key, $labels);
    }

    /**
     * The labels the editor sent with its references, ID (in lower case) → label, read from the JSON as it came: the
     * stored reference never keeps its label (A229), but one the writer may not make becomes this text.
     *
     * @param  array<mixed>  $json
     * @return array<string, string>
     */
    public static function referenceLabels(array $json): array
    {
        $labels = [];
        $attrs = $json['attrs'] ?? null;
        if (($json['type'] ?? null) === 'reference' && is_array($attrs) && is_string($attrs['id'] ?? null) && is_string($attrs['label'] ?? null)) {
            $labels[strtolower($attrs['id'])] = $attrs['label'];
        }
        foreach (is_array($json['content'] ?? null) ? $json['content'] : [] as $child) {
            if (is_array($child)) {
                $labels += self::referenceLabels($child);
            }
        }

        return $labels;
    }
}
