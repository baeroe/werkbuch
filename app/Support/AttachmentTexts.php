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
     *
     * Nothing is locked here (N1): the items of the project come in blocks over the index (`project_id`, `number`),
     * their descriptions by key, their values and comments over the index of `work_item_id`; no read scans another
     * project. Who needs the texts as they are now reads them in READ COMMITTED (ReadCommitted, handOverOrRemove).
     *
     * @param  list<string>|null  $only
     * @param  list<string>  $exceptItems
     * @param  list<string>  $exceptComments
     * @return array<string, array{type: string, id: string}>
     *
     * @throws UnreadableText without `$lenient`
     */
    public static function namers(string $projectId, ?array $only = null, array $exceptItems = [], array $exceptComments = [], bool $lenient = false): array
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
        $naming = function (Builder $query, string $column) use ($only): void {
            if ($only !== null) {
                $query->where(function (Builder $any) use ($column, $only): void {
                    foreach ($only as $id) {
                        $any->orWhere($column, 'like', "%{$id}%");
                    }
                });
            }
        };
        $item = (new WorkItem)->getMorphClass();
        $comment = (new Comment)->getMorphClass();
        $richText = Property::query()->where('field_type', FieldType::RichText)->pluck('id')->all();

        WorkItem::query()->where('project_id', $projectId)->whereNotIn('id', $exceptItems)->select(['id', 'number'])
            ->chunkById(self::READ_BLOCK, function (Collection $block) use ($naming, $note, $item, $comment, $richText, $exceptComments): void {
                $ids = $block->modelKeys();

                $descriptions = WorkItem::query()->whereKey($ids)->whereNotNull('description');
                $naming($descriptions, 'description');
                $descriptions->get(['id', 'description'])->each(fn (WorkItem $row) => $note($row->description, $item, $row->id));

                $values = WorkItemValue::query()->whereIn('work_item_id', $ids)->whereIn('property_id', $richText);
                $naming($values, 'value_json');
                $values->get(['work_item_id', 'value_json'])->each(fn (WorkItemValue $row) => $note($row->value_json, $item, $row->work_item_id));

                $comments = Comment::query()->whereIn('work_item_id', $ids)->whereNotIn('id', $exceptComments);
                $naming($comments, 'body');
                $comments->get(['id', 'body'])->each(fn (Comment $row) => $note($row->body, $comment, $row->id));
            }, 'number');

        return $namers;
    }

    /**
     * For attachments whose owner is about to go (read `for update` by the caller, inside its transaction): those another
     * text of the project still names become that text's (a picture or file of a text, `inline`), the rest go, their
     * rows through the query builder and their files after the commit (AttachmentFiles, K12). `$exceptItems` and
     * `$exceptComments` are the texts that go with the owner. A text that cannot be read names nothing here (reported).
     * The caller runs in READ COMMITTED (ReadCommitted::run): after the lock on the attachments, a text that named one
     * and committed while the caller waited counts, though the caller read other rows before (T13-M8); a text saved
     * later waits for the attachment's row in AttachmentLinks and finds it gone or handed over.
     *
     * @param  Collection<int, Attachment>  $attachments
     * @param  list<string>  $exceptItems
     * @param  list<string>  $exceptComments
     */
    public static function handOverOrRemove(Collection $attachments, string $projectId, array $exceptItems = [], array $exceptComments = []): void
    {
        $namers = self::namers($projectId, array_values(array_map(strval(...), $attachments->modelKeys())), $exceptItems, $exceptComments, lenient: true);
        foreach ($namers as $id => $owner) {
            Attachment::query()->whereKey($id)->update(['attachable_type' => $owner['type'], 'attachable_id' => $owner['id'], 'kind' => 'inline']);
        }

        $gone = $attachments->reject(fn (Attachment $attachment) => isset($namers[$attachment->id]));
        AttachmentFiles::removeAfterCommit($gone);
        // the query builder, never $attachment->delete(): medialibrary would remove the files before the commit (K12)
        Attachment::query()->whereKey($gone->modelKeys())->delete();
    }
}
