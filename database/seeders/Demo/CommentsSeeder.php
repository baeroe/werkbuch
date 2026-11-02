<?php

namespace Database\Seeders\Demo;

use App\Models\Comment;
use App\Models\CommentReaction;
use App\Models\User;
use App\Models\WorkItem;
use App\Models\WorkItemSubscriber;
use App\RichText\Document;
use App\Support\RichTextRules;
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
     * The comments by item, author and time (`MM-DD HH:mm`, Berlin time), the text as Markdown and the reactions
     * (emoji → handles, in the order they reacted).
     *
     * @var list<array{0: string, 1: string, 2: string, 3: string, 4?: array<string, list<string>>}>
     */
    private const COMMENTS = [
        ['WEB-47', 'mara', '10-27 14:42', 'Kann ich reproduzieren, nur unter iOS 18.', ['👍' => ['ida', 'jonas']]],
        // with a code block, so the item shows the highlighting of code (spec 4.16)
        ['WEB-47', 'jonas', '10-28 08:50', "Ich schaue mir den Submit-Handler an. Vermutlich feuert das Formular-Plugin zweimal:\n\n```\nform.addEventListener('submit', sendMail);\n// das Plugin hängt sich noch einmal an\nplugin.on('submit', (event) => sendMail(event, { retries: 2 }));\n```"],
        ['WEB-42', 'ida', '10-28 08:40', 'Hero-Entwurf ist drin, die Teaser kommen heute Nachmittag. @mara kannst du die Texte kurz gegenlesen?'],
        ['WEB-42', 'lene', '10-28 09:05', 'Die Bildzuschnitte für Mobil schicke ich dir bis mittags.', ['🙌' => ['ida']]],
        ['WEB-30', 'mara', '10-05 11:10', 'Phase 1 endet am 15.11. Danach starten wir mit den Leistungsseiten und dem Journal.'],
        ['WEB-45', 'ida', '10-22 09:32', 'Studio Nordlicht liefert die Texte bis Freitag nach. Ohne sie kann ich die Leistungsseiten nicht befüllen.'],
        ['WEB-45', 'mara', '10-27 15:00', 'Ich erinnere den Kunden morgen noch einmal.'],
        ['WEB-48', 'lene', '10-27 16:30', 'Burger-Menü oder Tab-Leiste? Ich skizziere beides bis Donnerstag.'],
        ['WEB-41', 'ida', '10-27 11:00', 'Hängt an den neuen Angaben zur Geschäftsführung. Ich habe heute noch einmal nachgefragt.'],
        ['WEB-39', 'jonas', '10-27 16:25', 'Umzug ist durch. Die TTL war vorher gesenkt, die alte Instanz bleibt noch eine Woche als Fallback.', ['🎉' => ['mara', 'ida', 'lene']]],
        ['WEB-40', 'lene', '10-23 14:12', 'Es fehlte das apple-touch-icon. Ist ergänzt und in Safari geprüft.'],
        ['OPS-12', 'kira', '10-26 15:30', 'Postfix erlaubt aktuell 100 Mails pro Stunde. Die Formularmails und der Wochenreport reichen damit nicht.'],
        ['OPS-12', 'jonas', '10-26 16:30', 'Setze ich um, sobald das Wartungsfenster steht.'],
        ['OPS-3', 'jonas', '10-26 17:00', 'Fehlt nur noch das Mail-Limit (OPS-12). @mara das Wartungsfenster für die alten Server brauche ich noch von dir.'],
        ['APP-5', 'theo', '10-20 09:10', 'Die Beta startet heute. Ziel ist eine TestFlight-Version für den Kunden bis Mitte Dezember.'],
        ['APP-12', 'lene', '10-27 17:10', 'Telefonnummer und Adresse sind fertig, bei der E-Mail-Adresse fehlt noch die Bestätigungsmail.'],
        ['APP-15', 'theo', '10-27 15:10', 'Hafenkontor möchte das bis Ende November. Wir brauchen noch das PDF-Layout vom Kunden.'],
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

        foreach (self::COMMENTS as $row) {
            $item = $fresh->get($row[0]);
            if ($item !== null) {
                $this->write($item, $row, $people);
            }
        }
    }

    /**
     * @param  array{0: string, 1: string, 2: string, 3: string, 4?: array<string, list<string>>}  $row
     * @param  Collection<string, User>  $people
     */
    private function write(WorkItem $item, array $row, Collection $people): void
    {
        $author = $this->person($people, $row[1]);
        $at = ItemsSeeder::at($row[2]);
        $body = Document::fromMarkdown($row[3], RichTextRules::context($item->project, $author, null));

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
        foreach ($row[4] ?? [] as $emoji => $handles) {
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
