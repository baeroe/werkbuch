<?php

namespace App\Support;

use App\Domain\Properties\FieldType;
use App\Models\Attachment;
use App\Models\Comment;
use App\Models\Property;
use App\Models\WorkItem;
use App\Models\WorkItemValue;
use App\RichText\Document;
use App\RichText\InvalidDocument;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection;

/**
 * Which saved texts of a project name which attachments: the descriptions and rich text values of its items and the
 * texts of their comments. A text may name a picture another text owns (copied from a comment into a description,
 * A233); such a picture must not go while a text still shows it. PruneAttachments keeps what any text names; deleting
 * an item or a comment hands what another text still names over to that text (handOverOrRemove, Ruling T13-I1).
 */
final class AttachmentTexts
{
    /**
     * The owners whose texts this reads (morph names): items (descriptions, rich text values) and comments. Pictures of
     * any other owner are none of its business (T13-M2): a later phase that gives attachments to pages or templates
     * adds its owner here together with its texts.
     */
    public const OWNERS = ['work_item', 'comment'];

    /** The texts read at a time. */
    private const READ_BLOCK = 500;

    /**
     * Attachment id → the text that names it: the owner of that text (the item of a description or value, or the
     * comment), the first by id when several do. Only the attachments of `$only` (all with `null`; their ids narrow the
     * rows read first by `like` and are then checked against the document), never the texts of `$exceptItems` (their
     * descriptions, values and comments) or of `$exceptComments`. A text that cannot be read is an UnreadableText; with
     * `$lenient` it is reported and names nothing (deleting an item or a comment must not depend on another text).
     * With `$locking` the texts are read under a shared lock: a locking read sees what committed last, also when the
     * caller's transaction read other rows before (its snapshot is older then), and a text saved meanwhile waits (T13-M8).
     *
     * @param  list<string>|null  $only
     * @param  list<string>  $exceptItems
     * @param  list<string>  $exceptComments
     * @return array<string, array{type: string, id: string}>
     *
     * @throws UnreadableText without `$lenient`
     */
    public static function namers(string $projectId, ?array $only = null, array $exceptItems = [], array $exceptComments = [], bool $lenient = false, bool $locking = false): array
    {
        if ($only === []) {
            return [];
        }

        $namers = [];
        $note = function (?array $json, string $type, string $owner) use (&$namers, $only, $lenient): void {
            try {
                $ids = $json === null ? [] : Document::fromJson($json)->attachmentIds();
            } catch (InvalidDocument $error) {
                $unreadable = new UnreadableText($type, $owner, $error);
                $lenient ? report($unreadable) : throw $unreadable;

                return;
            }
            foreach ($ids as $id) {
                if (($only === null || in_array($id, $only, true)) && (! isset($namers[$id]) || strcmp($owner, $namers[$id]['id']) < 0)) {
                    $namers[$id] = ['type' => $type, 'id' => $owner];
                }
            }
        };
        // the ids narrow the rows the database hands over, the documents decide
        $naming = function (Builder $query, string $column) use ($only, $locking): void {
            if ($locking) {
                $query->sharedLock();
            }
            if ($only !== null) {
                $query->where(function (Builder $any) use ($column, $only): void {
                    foreach ($only as $id) {
                        $any->orWhere($column, 'like', "%{$id}%");
                    }
                });
            }
        };
        $items = WorkItem::query()->where('project_id', $projectId)->whereNotIn('id', $exceptItems)->select('id');
        $item = (new WorkItem)->getMorphClass();
        $comment = (new Comment)->getMorphClass();

        $descriptions = WorkItem::query()->where('project_id', $projectId)->whereNotIn('id', $exceptItems)->whereNotNull('description');
        $naming($descriptions, 'description');
        $descriptions->select(['id', 'description'])->lazyById(self::READ_BLOCK)
            ->each(fn (WorkItem $row) => $note($row->description, $item, $row->id));

        $values = WorkItemValue::query()->whereIn('work_item_id', $items)
            ->whereIn('property_id', Property::query()->where('field_type', FieldType::RichText)->select('id'));
        $naming($values, 'value_json');
        $values->select(['id', 'work_item_id', 'value_json'])->lazyById(self::READ_BLOCK)
            ->each(fn (WorkItemValue $row) => $note($row->value_json, $item, $row->work_item_id));

        $comments = Comment::query()->whereIn('work_item_id', $items)->whereNotIn('id', $exceptComments);
        $naming($comments, 'body');
        $comments->select(['id', 'body'])->lazyById(self::READ_BLOCK)
            ->each(fn (Comment $row) => $note($row->body, $comment, $row->id));

        return $namers;
    }

    /**
     * For attachments whose owner is about to go (read `for update` by the caller, inside its transaction): those another
     * text of the project still names become that text's (a picture or file of a text, `inline`), the rest go, their
     * rows through the query builder and their files after the commit (AttachmentFiles, K12). `$exceptItems` and
     * `$exceptComments` are the texts that go with the owner. A text that cannot be read names nothing here (reported).
     * The texts are read under a shared lock (namers()): a text that named an attachment and committed while the caller
     * waited for the attachment's row counts, though the caller's snapshot is older (T13-M8).
     *
     * @param  Collection<int, Attachment>  $attachments
     * @param  list<string>  $exceptItems
     * @param  list<string>  $exceptComments
     */
    public static function handOverOrRemove(Collection $attachments, string $projectId, array $exceptItems = [], array $exceptComments = []): void
    {
        $namers = self::namers($projectId, array_values(array_map(strval(...), $attachments->modelKeys())), $exceptItems, $exceptComments, lenient: true, locking: true);
        foreach ($namers as $id => $owner) {
            Attachment::query()->whereKey($id)->update(['attachable_type' => $owner['type'], 'attachable_id' => $owner['id'], 'kind' => 'inline']);
        }

        $gone = $attachments->reject(fn (Attachment $attachment) => isset($namers[$attachment->id]));
        AttachmentFiles::removeAfterCommit($gone);
        // the query builder, never $attachment->delete(): medialibrary would remove the files before the commit (K12)
        Attachment::query()->whereKey($gone->modelKeys())->delete();
    }
}
