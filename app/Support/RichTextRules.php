<?php

namespace App\Support;

use App\Access\Assignable;
use App\Models\Attachment;
use App\Models\Project;
use App\Models\User;
use App\RichText\Document;
use App\RichText\InvalidDocument;
use App\RichText\MarkdownContext;
use Illuminate\Validation\ValidationException;

/**
 * The rules of saving a rich text (plan „Regeln beim Speichern“), the same for JSON and Markdown, run before any lock
 * (they only read, by ID):
 * - a mention stays a node, with its label set to the current handle, when the account may be mentioned in the project
 *   (Assignable, A231) or the text mentioned it before; any other becomes the text `@<label>` (nothing without one);
 * - a reference to an item stays a node when the writer sees the item (Visibility, never a project being deleted) or the
 *   text referred to it before (A229); any other (a page too, until Phase 9) becomes the label its sender gave it (the
 *   writer's own client named it, so it tells nothing), nothing without one;
 * - an image or a file must name an attachment of the text's project that has an owner or was uploaded by the writer
 *   (A233); a file takes its file name from the row. Anything else is a 422 `field.rich_text.attachment` at the key
 *   that sent the text (13c), except one the text had before and that is gone: it leaves the text (I1).
 *
 * Accounts, items and attachments each come with one query for the whole text (in blocks of RichTextLookups::CHUNK),
 * never one per node.
 */
final class RichTextRules
{
    /** The context to read a writer's text in the project, the text as it was before kept (K9). */
    public static function context(Project $project, User $writer, ?Document $before): MarkdownContext
    {
        return new MarkdownContext(
            $project,
            new RichTextLookups($project, $writer),
            $before?->mentionedUserIds() ?? [],
            $before?->itemRefs() ?? [],
            $writer,
            $before,
        );
    }

    /**
     * @param  array<string, string>  $labels  ID → label of the references as sent (RichTextInput::referenceLabels())
     *
     * @throws ValidationException at `$field`
     * @throws InvalidDocument when the labels make the text too long
     */
    public static function apply(Document $doc, Project $project, User $writer, ?Document $before, string $field, array $labels = []): Document
    {
        $mentioned = $doc->mentionedUserIds();
        $referred = [...$doc->itemRefs(), ...$doc->pageRefs()];
        $attached = $doc->attachmentIds();
        if ($mentioned === [] && $referred === [] && $attached === []) {
            return $doc;
        }

        $handles = self::handles($mentioned, $project, $before?->mentionedUserIds() ?? []);
        $items = self::items($doc->itemRefs(), $project, $writer, $before?->itemRefs() ?? []);
        $files = self::attachments($attached, $project, $writer, $field, $before?->attachmentIds() ?? []);

        return $doc->withNodes(function (array $node) use ($handles, $items, $files, $labels): array|string|null {
            /** @var array<string, mixed> $attrs */
            $attrs = $node['attrs'];

            return match ($node['type']) {
                'mention' => self::mention($node, $attrs, $handles),
                'reference' => $attrs['kind'] === 'item' && isset($items[$attrs['id']]) ? $node : $labels[$attrs['id']] ?? null,
                // a picture or file the text had before and that is gone meanwhile goes from the text
                'image' => isset($files[$attrs['attachmentId']]) ? $node : null,
                'attachment' => isset($files[$attrs['attachmentId']]) ? ['type' => 'attachment', 'attrs' => ['filename' => $files[$attrs['attachmentId']]] + $attrs] + $node : null,
                default => $node,
            };
        });
    }

    /**
     * Whether a text of the project may name the attachment: one of the project that has an owner (another text of the
     * project, A233) or that the writer uploaded and nobody owns yet.
     */
    public static function usable(Attachment $attachment, Project $project, User $writer): bool
    {
        return $attachment->project_id === $project->id && ($attachment->attachable_id !== null || $attachment->uploaded_by === $writer->id);
    }

    /**
     * @param  array<string, mixed>  $node
     * @param  array<string, mixed>  $attrs
     * @param  array<string, string>  $handles
     * @return array<string, mixed>|string|null
     */
    private static function mention(array $node, array $attrs, array $handles): array|string|null
    {
        $id = (string) $attrs['id'];
        if (isset($handles[$id])) {
            return ['type' => 'mention', 'attrs' => ['label' => $handles[$id]] + $attrs] + $node;
        }
        $label = $attrs['label'];

        return is_string($label) && $label !== '' ? '@'.$label : null;
    }

    /**
     * The current handles of the mentioned accounts that stay mentions: those the text mentioned before and those who
     * may be mentioned in the project.
     *
     * @param  list<string>  $ids
     * @param  list<string>  $kept
     * @return array<string, string> ID → handle
     */
    private static function handles(array $ids, Project $project, array $kept): array
    {
        $handles = [];
        foreach (array_chunk($ids, RichTextLookups::CHUNK) as $chunk) {
            $users = User::query()->whereKey($chunk)->get();
            $allowed = Assignable::among($users->reject(fn (User $user) => in_array($user->id, $kept, true)), $project);
            foreach ($users as $user) {
                if (in_array($user->id, $kept, true) || in_array($user->id, $allowed, true)) {
                    $handles[$user->id] = $user->handle;
                }
            }
        }

        return $handles;
    }

    /**
     * The referred items that stay references: those the text referred to before and those the writer sees.
     *
     * @param  list<string>  $ids
     * @param  list<string>  $kept
     * @return array<string, true>
     */
    private static function items(array $ids, Project $project, User $writer, array $kept): array
    {
        $new = array_values(array_diff($ids, $kept));
        $lookups = new RichTextLookups($project, $writer);
        $lookups->prepare([], [], $new);

        return array_fill_keys([...array_intersect($ids, $kept), ...array_filter($new, $lookups->visibleItem(...))], true);
    }

    /**
     * The file names of the attachments, each checked (usable()). One the text had before (`$kept`) and that is gone
     * meanwhile is left out without an error, so a dead node never blocks saving its text; the caller drops it.
     *
     * @param  list<string>  $ids
     * @param  list<string>  $kept
     * @return array<string, string> ID → file name
     *
     * @throws ValidationException
     */
    private static function attachments(array $ids, Project $project, User $writer, string $field, array $kept): array
    {
        $names = [];
        foreach (array_chunk($ids, RichTextLookups::CHUNK) as $chunk) {
            $rows = Attachment::query()->whereKey($chunk)->get(['id', 'project_id', 'attachable_id', 'uploaded_by', 'filename'])->keyBy('id');
            foreach ($chunk as $id) {
                $row = $rows->get($id);
                if ($row === null && in_array($id, $kept, true)) {
                    continue;
                }
                if ($row === null || ! self::usable($row, $project, $writer)) {
                    throw ValidationException::withMessages([$field => __('field.rich_text.attachment')]);
                }
                $names[$id] = $row->filename;
            }
        }

        return $names;
    }
}
