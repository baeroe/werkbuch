<?php

namespace App\Support;

use App\Models\Project;
use App\Models\User;
use App\RichText\Document;
use App\RichText\RichTextInput;
use Illuminate\Validation\ValidationException;

/**
 * The text of a comment from an input: `body` (Markdown) or `body_json` (Tiptap JSON), read through the rules of saving
 * for the writer in the project (RichTextRules), with the comment as it was (`$before`) when it is edited. Read before
 * any lock: Markdown may take a second. A text that is empty after the rules (nothing but blanks) is a 422
 * `field.body.required` at `body`; a comment of only a picture is not empty (P2).
 */
final class CommentInput
{
    /**
     * @param  array<array-key, mixed>  $input
     * @return array{0: Document, 1: string} the text and the key that sent it (`body` or `body_json`)
     *
     * @throws ValidationException
     */
    public static function body(array $input, Project $project, User $writer, ?Document $before): array
    {
        /** @var array<string, mixed> $input */
        $body = RichTextInput::from($input, 'body', RichTextRules::context($project, $writer, $before));
        if ($body === null) {
            throw ValidationException::withMessages(['body' => __('field.body.required')]);
        }

        return [$body, array_key_exists('body', $input) ? 'body' : 'body_json'];
    }
}
