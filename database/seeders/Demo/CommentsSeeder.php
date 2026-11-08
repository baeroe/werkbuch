<?php

namespace Database\Seeders\Demo;

use App\Models\Comment;
use App\Models\CommentReaction;
use App\Models\User;
use App\Models\WorkItem;
use App\Models\WorkItemSubscriber;
use App\RichText\Document;
use App\Support\RichTextRules;
use Database\Seeders\Demo\Texts\DemoTexts;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * The comments of the demo items with their reactions (the `comment(…)` rows of src/api/seed/activity.ts;
 * `CommentsSeederTest` reads that file and compares comment by comment). A text is read as Markdown with the lookup of
 * its author (RichTextRules::context()), as the API reads a comment: `@mara` becomes a mention, `OPS-12` a reference.
 * Who commented and whom a comment mentions watch the item (`commented`, `mentioned`), bots never. Written directly,
 * without events, like the other demo seeders (A86); the search index is built anew at the end of the DemoSeeder.
 *
 * Safe to run again (like K14): an item gets its comments only while it has none, so a second run, and an item
 * somebody commented on since, keep theirs. Watchers are found by (item, person) and never changed.
 */
class CommentsSeeder extends Seeder
{
    use WithoutModelEvents;

    /**
     * The comments by item, author and time (`MM-DD HH:mm`, Berlin time) and the reactions (emoji → handles, in the order
     * they reacted). The text is DemoTexts' `comment.<KEY>.<n>`, Markdown, n counting the comments of the item in this
     * order (the `c_<item>_<n>` of the clickdummy).
     *
     * @var list<array{0: string, 1: string, 2: string, 3?: array<string, list<string>>}>
     */
    private const COMMENTS = [
        ['WEB-47', 'mara', '10-27 14:42', ['👍' => ['ida', 'jonas']]],
        // with a code block, so the item shows the highlighting of code (spec 4.16)
        ['WEB-47', 'jonas', '10-28 08:50'],
        ['WEB-42', 'ida', '10-28 08:40'],
        ['WEB-42', 'lene', '10-28 09:05', ['🙌' => ['ida']]],
        ['WEB-30', 'mara', '10-05 11:10'],
        ['WEB-45', 'ida', '10-22 09:32'],
        ['WEB-45', 'mara', '10-27 15:00'],
        ['WEB-48', 'lene', '10-27 16:30'],
        ['WEB-41', 'ida', '10-27 11:00'],
        ['WEB-39', 'jonas', '10-27 16:25', ['🎉' => ['mara', 'ida', 'lene']]],
        ['WEB-40', 'lene', '10-23 14:12'],
        ['OPS-12', 'kira', '10-26 15:30'],
        ['OPS-12', 'jonas', '10-26 16:30'],
        ['OPS-3', 'jonas', '10-26 17:00'],
        ['APP-5', 'theo', '10-20 09:10'],
        ['APP-12', 'lene', '10-27 17:10'],
        ['APP-15', 'theo', '10-27 15:10'],
    ];

    public function run(): void
    {
        // one transaction: a run that breaks halfway would leave items with part of their comments, and a rerun skips
        // every item that has any
        DB::transaction(fn () => $this->seed());
    }

    private function seed(): void
    {
        $people = User::query()->get()->keyBy('handle');
        /** @var Collection<string, WorkItem> $items by key, only those that have no comment yet */
        $items = collect(array_unique(array_column(self::COMMENTS, 0)))
            ->mapWithKeys(fn (string $key) => [$key => ItemsSeeder::find($key)])->filter()->toBase();
        // read before anything is written: an item without comments now gets all of its own
        $commented = Comment::query()->whereIn('work_item_id', $items->map->id->all())->distinct()->pluck('work_item_id')->flip();
        $fresh = $items->reject(fn (WorkItem $item) => $commented->has($item->id));

        $counts = [];
        foreach (self::COMMENTS as $row) {
            $n = $counts[$row[0]] = ($counts[$row[0]] ?? 0) + 1;
            $item = $fresh->get($row[0]);
            if ($item !== null) {
                $this->write($item, $row, DemoTexts::get("comment.{$row[0]}.{$n}"), $people);
            }
        }
    }

    /**
     * @param  array{0: string, 1: string, 2: string, 3?: array<string, list<string>>}  $row
     * @param  Collection<string, User>  $people
     */
    private function write(WorkItem $item, array $row, string $text, Collection $people): void
    {
        $author = $this->person($people, $row[1]);
        $at = ItemsSeeder::at($row[2]);
        $body = Document::fromMarkdown($text, RichTextRules::context($item->project, $author, null));

        $comment = new Comment;
        $comment->forceFill([
            'work_item_id' => $item->id,
            'author_id' => $author->id,
            'body' => $body->toJson(),
            'body_text' => $body->toText(),
            'created_at' => $at,
            'updated_at' => $at,
        ])->save();

        // a minute apart, so the reactions keep the order of the seed (the API lists them by time)
        $minutes = 0;
        foreach ($row[3] ?? [] as $emoji => $handles) {
            foreach ($handles as $handle) {
                $when = $at->addMinutes(++$minutes);
                (new CommentReaction)->forceFill([
                    'comment_id' => $comment->id,
                    'user_id' => $this->person($people, $handle)->id,
                    'emoji' => $emoji,
                    'created_at' => $when,
                    'updated_at' => $when,
                ])->save();
            }
        }

        $this->watch($item, $author, 'commented');
        foreach ($body->mentionedUserIds() as $id) {
            $mentioned = $people->firstWhere('id', $id);
            if ($mentioned !== null) {
                $this->watch($item, $mentioned, 'mentioned');
            }
        }
    }

    /** A person watches the item for this reason, unless they watch (or unsubscribed) already; bots never. */
    private function watch(WorkItem $item, User $user, string $reason): void
    {
        if ($user->isPerson() && $user->disabled_at === null) {
            WorkItemSubscriber::query()->firstOrCreate(['work_item_id' => $item->id, 'user_id' => $user->id], ['reason' => $reason]);
        }
    }

    /**
     * @param  Collection<string, User>  $people
     */
    private function person(Collection $people, string $handle): User
    {
        return $people[$handle] ?? throw new RuntimeException("No account @{$handle}.");
    }
}
