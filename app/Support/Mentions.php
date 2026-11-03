<?php

namespace App\Support;

use App\Models\User;
use App\Models\WorkItem;
use App\Models\WorkItemSubscriber;
use App\RichText\Document;

/**
 * Who a change of a text mentions anew (spec 4.10, 4.14): whoever the text mentions now and did not before. A newly
 * mentioned person watches the item from now on (reason `mentioned`); an unsubscription is lifted, since only a new
 * mention or assignment brings a person back (A113); who watches already keeps their reason. Bots watch nothing; the
 * caller records `bot.mentioned` for them (only actions record events). Whoever writes the text is never mentioned by
 * it (A259): mentioning yourself lifts no opt-out, names you in no `meta.mentioned` and tells your own bot nothing.
 */
final class Mentions
{
    /**
     * The people the texts of an item mention: its description and its rich text values (A244), from the loaded
     * `values.property`.
     *
     * @return list<string>
     */
    public static function ofItem(WorkItem $item): array
    {
        $texts = ItemValues::documentsOf($item);
        if ($item->description !== null) {
            $texts[] = Document::fromJson($item->description);
        }

        return array_values(array_unique(array_merge([], ...array_map(fn (Document $text) => $text->mentionedUserIds(), array_values($texts)))));
    }

    /**
     * The accounts `$after` names that `$before` does not, in the order of `$after`, without the writer (A259); the
     * people among them watch the item.
     *
     * @param  list<string>  $before  IDs mentioned before
     * @param  list<string>  $after  IDs mentioned now
     * @return list<User>
     */
    public static function after(WorkItem $item, array $before, array $after, User $writer): array
    {
        $new = array_values(array_diff(array_unique($after), $before, [$writer->id]));
        if ($new === []) {
            return [];
        }

        $users = User::query()->whereKey($new)->get()->keyBy('id');
        $people = $users->filter(fn (User $user) => $user->isPerson())->modelKeys();
        $rows = WorkItemSubscriber::query()->where('work_item_id', $item->id)->whereIn('user_id', $people)->get()->keyBy('user_id');
        foreach ($people as $id) {
            $row = $rows->get($id);
            if ($row === null) {
                WorkItemSubscriber::query()->create(['work_item_id' => $item->id, 'user_id' => $id, 'reason' => 'mentioned']);
            } elseif ($row->unsubscribed_at !== null) {
                $row->update(['reason' => 'mentioned', 'unsubscribed_at' => null]);
            }
        }

        return array_values(array_filter(array_map(fn (string $id) => $users->get($id), $new)));
    }

    /**
     * Who the sent texts of an item mention anew (A244): in the description first, then in the rich text values, each
     * against all the item mentioned before (ofItem()) and, for the values, the description now.
     *
     * @param  list<string>  $before
     * @param  array<string, Document>  $texts  as ItemInput::documents() names them (`description`, `values.<key>`)
     * @return array{description: list<User>, values: list<User>}
     */
    public static function anew(WorkItem $item, array $before, array $texts, User $writer): array
    {
        $description = $values = [];
        foreach ($texts as $field => $text) {
            if (str_starts_with($field, 'values.')) {
                array_push($values, ...$text->mentionedUserIds());
            } else {
                array_push($description, ...$text->mentionedUserIds());
            }
        }
        $byDescription = self::after($item, $before, $description, $writer);

        return ['description' => $byDescription, 'values' => self::after($item, [...$before, ...$description], $values, $writer)];
    }

    /**
     * `meta.mentioned` of the event of the change: the IDs mentioned anew, nothing when nobody is.
     *
     * @param  array<string, list<User>>  $mentioned
     * @return array{mentioned?: list<string>}
     */
    public static function meta(array $mentioned): array
    {
        $ids = array_map(fn (User $user) => $user->id, array_merge([], ...array_values($mentioned)));

        return $ids === [] ? [] : ['mentioned' => $ids];
    }
}
