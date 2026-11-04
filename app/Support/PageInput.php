<?php

namespace App\Support;

use App\Domain\Emoji;
use App\Models\Page;
use App\Models\Project;
use App\Models\User;
use App\RichText\Document;
use App\RichText\RichTextInput;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * The fields of a page from an input (CreatePage, UpdatePage). Each check notes its first error per field in `$errors`
 * (key → messages) instead of throwing, so the checks before a lock (title, emoji, text, base version) and the ones
 * under it (the parent) end in one 422 (refuse()). The text is read before any lock: Markdown may take a second.
 */
final class PageInput
{
    public const TITLE_MAX = 200;

    /**
     * The title trimmed (`Str::trim`, Unicode blanks too); empty or longer than TITLE_MAX is an error at `title`.
     *
     * @param  array<array-key, mixed>  $input
     * @param  array<string, list<string>>  $errors
     */
    public static function title(array $input, array &$errors): string
    {
        $title = is_string($input['title'] ?? null) ? Str::trim($input['title']) : '';
        if ($title === '') {
            self::fail($errors, 'title', 'field.title.required');
        } elseif (mb_strlen($title) > self::TITLE_MAX) {
            self::fail($errors, 'title', 'field.title.max', ['max' => self::TITLE_MAX]);
        }

        return $title;
    }

    /**
     * No emoji (`null`, `''`) or exactly one (Emoji::is); anything else is an error at `emoji`.
     *
     * @param  array<array-key, mixed>  $input
     * @param  array<string, list<string>>  $errors
     */
    public static function emoji(array $input, array &$errors): ?string
    {
        $emoji = $input['emoji'] ?? null;
        if ($emoji === null || $emoji === '') {
            return null;
        }
        if (! is_string($emoji) || ! Emoji::is($emoji)) {
            self::fail($errors, 'emoji', 'field.emoji.invalid');

            return null;
        }

        return $emoji;
    }

    /**
     * The text of the input (`content` as Markdown or `content_json` as Tiptap JSON) through the rules of saving for
     * the writer in the project, with the stored text as the one before (what it mentioned and referred to stays, A229),
     * and the key that sent it; `null` when the input sends no text. A refused text is an error at that key (and no
     * document); an empty one clears the page.
     *
     * @param  array<array-key, mixed>  $input
     * @param  array<string, list<string>>  $errors
     * @return array{0: ?Document, 1: string}|null
     */
    public static function content(array $input, Project $project, User $writer, ?Document $before, array &$errors): ?array
    {
        /** @var array<string, mixed> $input */
        if (! RichTextInput::given($input, 'content')) {
            return null;
        }
        $key = array_key_exists('content', $input) ? 'content' : 'content_json';
        try {
            return [RichTextInput::from($input, 'content', RichTextRules::context($project, $writer, $before)), $key];
        } catch (ValidationException $refused) {
            foreach ($refused->errors() as $field => $messages) {
                $errors[(string) $field] ??= array_values(array_map(strval(...), $messages));
            }

            return [null, $key];
        }
    }

    /**
     * The version the client edited: a whole number from 1 or `null` (none sent); anything else is an error at
     * `base_version`.
     *
     * @param  array<array-key, mixed>  $input
     * @param  array<string, list<string>>  $errors
     */
    public static function baseVersion(array $input, array &$errors): ?int
    {
        $version = $input['base_version'] ?? null;
        if ($version !== null && (! is_int($version) || $version < 1)) {
            self::fail($errors, 'base_version', 'field.base_version.invalid');

            return null;
        }

        return $version;
    }

    /**
     * Whether the writer asks to keep the stored state as a version ("Meine Fassung übernehmen", A307): the values of
     * Laravel's `boolean` rule, `null` is no; anything else is an error at `keep_current`.
     *
     * @param  array<array-key, mixed>  $input
     * @param  array<string, list<string>>  $errors
     */
    public static function keepCurrent(array $input, array &$errors): bool
    {
        $keep = $input['keep_current'] ?? null;
        if ($keep !== null && ! in_array($keep, [true, false, 0, 1, '0', '1'], true)) {
            self::fail($errors, 'keep_current', 'field.boolean');

            return false;
        }

        return in_array($keep, [true, 1, '1'], true);
    }

    /**
     * The parent page from `parent_id` (a ULID in any case, `null` for the top level): a page of the project. Any other
     * value, an unknown page and one of another project are the same error at `parent_id`, which tells nothing about
     * another project (K8). Under PageLock::tree, which keeps the tree as it is read.
     *
     * @param  array<array-key, mixed>  $input
     * @param  array<string, list<string>>  $errors
     */
    public static function parent(array $input, Project $project, array &$errors): ?Page
    {
        $id = Ids::normalize($input['parent_id'] ?? null);
        if ($id === null) {
            return null;
        }
        $parent = is_string($id) && Str::isUlid($id) ? Page::query()->where('project_id', $project->id)->find($id) : null;
        if ($parent === null) {
            self::fail($errors, 'parent_id', 'field.parent_page.unknown');
        }

        return $parent;
    }

    /**
     * Notes the message at the field, unless the field has one already (the first error counts).
     *
     * @param  array<string, list<string>>  $errors
     * @param  array<string, mixed>  $replace
     */
    private static function fail(array &$errors, string $field, string $key, array $replace = []): void
    {
        $message = __($key, $replace);
        $errors[$field] ??= [is_string($message) ? $message : $key];
    }

    /**
     * @param  array<string, list<string>>  $errors
     *
     * @throws ValidationException with every error noted, when there is one
     */
    public static function refuse(array $errors): void
    {
        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }
    }
}
