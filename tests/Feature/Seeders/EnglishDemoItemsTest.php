<?php

use App\Enums\Locale;
use App\Models\Attachment;
use App\Models\Comment;
use App\Models\Event;
use App\Models\Label;
use App\Models\Project;
use App\Models\Property;
use App\Models\PropertyOption;
use App\Models\RelationType;
use App\Models\Resolution;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkItem;
use App\Models\WorkItemRelation;
use App\Models\WorkItemSubscriber;
use App\Models\WorkItemType;
use App\RichText\Document;
use App\RichText\MarkdownContext;
use Database\Seeders\Demo\ItemsSeeder;
use Database\Seeders\Demo\Texts\DemoTexts;
use Database\Seeders\Demo\Texts\English;
use Database\Seeders\Demo\Texts\German;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\Support\DemoItemsSeeder;
use Tests\Support\EnglishDemoItemsSeeder;
use Tests\Support\FakeRichTextLookup;
use Tests\Support\SharedDemoTexts;

// the language is static: a test that fails midway must not leave English to the next one
afterEach(fn () => DemoTexts::use(Locale::De));

beforeEach(function () {
    // the demo files land on the disk `local`; the seeders end with a rebuilt search index
    Storage::fake('local');
    searchEngine();
});

$germanIn = SharedDemoTexts::germanIn(...);

/** The keys of the texts of the items, comments and files. */
$itemKeys = fn (): array => array_values(array_filter(array_keys(German::TEXTS), fn (string $key) => preg_match('/^(item|comment|file)\./', $key) === 1));

/**
 * Every id the seeded demo knows, replaced by what it names in either language: an account by its handle, an item by
 * its key, a catalog entry by its place, an option by its property and place.
 *
 * @return array<string, string>
 */
$tokens = function (): array {
    $workflows = Workflow::query()->orderBy('id')->with('states')->get()->values();

    return [
        ...User::query()->pluck('handle', 'id')->map(fn (string $handle) => "user:{$handle}")->all(),
        ...Project::query()->pluck('identifier', 'id')->map(fn (string $identifier) => "project:{$identifier}")->all(),
        ...WorkItem::query()->with('project')->get()->mapWithKeys(fn (WorkItem $item) => [$item->id => "item:{$item->key}"])->all(),
        ...WorkItemType::query()->orderBy('id')->pluck('id')->flip()->map(fn (int $place) => "type:{$place}")->all(),
        ...Label::query()->orderBy('id')->pluck('id')->flip()->map(fn (int $place) => "label:{$place}")->all(),
        ...Resolution::query()->pluck('position', 'id')->map(fn (int $position) => "resolution:{$position}")->all(),
        ...RelationType::query()->orderBy('id')->get()->values()->mapWithKeys(fn (RelationType $type, int $place) => [$type->id => 'relation:'.($type->built_in ?? $place)])->all(),
        ...$workflows->flatMap(fn (Workflow $workflow, int $place) => $workflow->states->mapWithKeys(fn ($state) => [$state->id => "state:{$place}:{$state->position}"]))->all(),
        ...Property::query()->with('options')->get()->flatMap(fn (Property $property) => $property->options
            ->mapWithKeys(fn (PropertyOption $option) => [$option->id => "option:{$property->key}:{$option->position}"]))->all(),
    ];
};

/**
 * The mentions and references of a stored document, in their order, by id.
 *
 * @param  array<string, mixed>|null  $doc
 * @return list<string>
 */
$nodes = function (?array $doc) use (&$nodes): array {
    $found = [];
    foreach ($doc['content'] ?? [] as $node) {
        if (in_array($node['type'], ['mention', 'reference'], true)) {
            $found[] = "{$node['type']}:{$node['attrs']['id']}";
        }
        array_push($found, ...$nodes($node));
    }

    return $found;
};

/**
 * What the items, their history, watchers, relations, comments and files are, without a text of a language: the
 * fingerprint both languages must share.
 *
 * @return array<string, mixed>
 */
$structure = function () use ($tokens, $nodes): array {
    // a state and a relation type carry their names in the language of the demo: what they are is their id
    $wordless = function (mixed $value) use (&$wordless): mixed {
        return is_array($value) ? array_map($wordless, array_diff_key($value, ['name' => true, 'label' => true])) : $value;
    };
    $stamp = fn (?DateTimeInterface $time) => $time?->format(DATE_ATOM);
    $items = WorkItem::query()->with(['project', 'labels', 'values.property'])->get()->sortBy(fn (WorkItem $item) => $item->key)->values();

    $fingerprint = [
        'items' => $items->map(fn (WorkItem $item) => [
            $item->project->identifier, $item->number, $item->type_id, $item->state_id, $item->resolution_id, $item->assignee_id,
            $item->priority->value, $item->start_date?->format('Y-m-d'), $item->due_date?->format('Y-m-d'), $item->parent_id, $item->rank,
            $item->created_by, $stamp($item->created_at), $stamp($item->started_at), $stamp($item->closed_at), $stamp($item->archived_at),
            $stamp($item->updated_at), $item->description_version, $item->description === null, $nodes($item->description),
            $item->labels->pluck('id')->sort()->values()->all(),
            // the values but their texts: text, URL and rich text are words of a language
            $item->values->reject(fn ($value) => in_array($value->property->field_type->value, ['text', 'url', 'rich_text'], true))
                ->map(fn ($value) => [$value->property->key, $value->position, $value->value_option_id, $value->value_user_id, $value->value_number, $value->value_bool, $value->value_date?->format('Y-m-d')])
                ->sortBy(fn (array $row) => $row[0].$row[1])->values()->all(),
            $item->values->filter(fn ($value) => in_array($value->property->field_type->value, ['text', 'url', 'rich_text'], true))->map(fn ($value) => $value->property->key)->sort()->values()->all(),
        ])->all(),
        'events' => Event::query()->where('subject_type', 'work_item')->orderBy('occurred_at')->orderBy('subject_id')->orderBy('type')->get()->map(fn (Event $event) => [
            $event->subject_id, $event->type->value, $event->actor_id, $event->occurred_at->format('Y-m-d H:i:s.u'), $wordless($event->meta),
            // a title is a text of a language
            $event->type->value === 'work_item.created' ? array_keys($event->changes ?? []) : $wordless($event->changes),
        ])->sortBy(fn (array $row) => $row[3].$row[0].$row[1])->values()->all(),
        'relations' => WorkItemRelation::query()->get()->map(fn (WorkItemRelation $relation) => [$relation->type_id, $relation->source_id, $relation->target_id, $stamp($relation->created_at)])
            ->sortBy(fn (array $row) => $row[1].$row[2])->values()->all(),
        'watchers' => WorkItemSubscriber::query()->get()->map(fn (WorkItemSubscriber $row) => [$row->work_item_id, $row->user_id, $row->reason, $row->unsubscribed_at])
            ->sortBy(fn (array $row) => $row[0].$row[1])->values()->all(),
        'comments' => Comment::query()->with('reactions')->orderBy('created_at')->get()->map(fn (Comment $comment) => [
            $comment->work_item_id, $comment->author_id, $stamp($comment->created_at), $comment->edited_at, $nodes($comment->body),
            array_column($comment->body['content'], 'type'),
            $comment->reactions->map(fn ($reaction) => [$reaction->emoji, $reaction->user_id, $stamp($reaction->created_at)])->all(),
        ])->all(),
        'files' => Attachment::query()->with('media')->get()->map(fn (Attachment $file) => [
            $file->attachable_type, $file->attachable_id, $file->project_id, $file->kind, $file->mime, $file->uploaded_by, $stamp($file->created_at),
            $file->getFirstMedia('file')?->mime_type,
        ])->sortBy(fn (array $row) => $row[1])->values()->all(),
    ];

    return json_decode(strtr((string) json_encode($fingerprint), $tokens()), true);
};

it('seeds the same items as the German demo, in English', function () use ($structure) {
    DB::beginTransaction();
    $this->seed(DemoItemsSeeder::class);
    $german = $structure();
    DB::rollBack();
    // the organization and the roles of the German run are gone with it
    app()->forgetScopedInstances();

    $this->seed(EnglishDemoItemsSeeder::class);
    $english = $structure();
    $rows = ItemsSeeder::rows();

    expect($english)->toBe($german)
        // the probe: the fingerprint holds every item, event and comment, by what they are
        ->and($german['items'])->toHaveCount(71)->and(count($rows))->toBe(71)
        ->and($german['events'])->toHaveCount(40)
        ->and($german['comments'])->toHaveCount(17)
        ->and($german['files'])->toHaveCount(3)
        ->and(json_encode($german))->toContain('user:mara', 'item:WEB-47', 'type:3', 'state:1:4', 'label:1', 'option:customer:0', 'option:environment:0', 'relation:blocks');

    // every row of the shared structure in English: its title and description are the English texts
    $plain = fn (?string $text) => $text === null ? null : str_replace(' ', '', (string) preg_replace('/[A-Z]+-\d+/', '', $text));
    foreach ($rows as $row) {
        $item = ItemsSeeder::find($row['key']);
        $description = English::TEXTS["item.{$row['key']}.description"] ?? null;

        expect($item?->title)->toBe(English::TEXTS["item.{$row['key']}.title"], $row['key'])
            // a key is a node, its plain text drops it; a mention reads as @handle either way
            ->and($plain($item?->description_text))->toBe($plain($description === null ? null : Document::fromMarkdown($description, new MarkdownContext)->toText()), $row['key']);
    }
});

it('keeps the mentions and references of every text', function () use ($itemKeys, $nodes) {
    $ulid = fn (): string => strtolower((string) Str::ulid());
    $people = collect(['mara', 'jonas', 'ida', 'theo', 'lene', 'sven', 'kira'])->mapWithKeys(fn (string $handle) => [$handle => $ulid()])->all();
    $items = collect(ItemsSeeder::rows())->mapWithKeys(fn (array $row) => [$row['key'] => $ulid()])->all();
    $read = fn (string $markdown): array => $nodes(Document::fromMarkdown($markdown, new MarkdownContext(lookup: new FakeRichTextLookup($people, [], $items)))->toJson());
    $texts = array_values(array_filter($itemKeys(), fn (string $key) => str_ends_with($key, '.description') || str_starts_with($key, 'comment.')));

    $nodesOf = fn (array $language): array => array_combine($texts, array_map(fn (string $key) => $read($language[$key]), $texts));
    $german = $nodesOf(German::TEXTS);

    expect($nodesOf(English::TEXTS))->toBe($german)
        // the probe: the texts name people and items, and a text that loses its key shows
        ->and(array_merge(...array_values($german)))->toContain("mention:{$people['mara']}", "reference:{$items['WEB-42']}", "reference:{$items['OPS-12']}", "reference:{$items['APP-9']}")
        ->and($read('Possibly related.'))->not->toBe($german['item.APP-10.description']);
});

it('seeds the same comments with their reactions', function () {
    $this->seed(EnglishDemoItemsSeeder::class);
    DemoTexts::use(Locale::En);
    $byItem = Comment::query()->with(['workItem.project', 'reactions'])->orderBy('created_at')->orderBy('id')->get()->groupBy(fn (Comment $comment) => $comment->workItem->key);

    expect($byItem->flatten()->count())->toBe(17);

    foreach ($byItem as $key => $comments) {
        foreach ($comments->values() as $index => $comment) {
            $n = $index + 1;
            $expected = Document::fromMarkdown(English::TEXTS["comment.{$key}.{$n}"], new MarkdownContext)->toText();

            // without a lookup a key and a mention stay text; the stored text drops the key of a reference
            expect(str_replace(' ', '', $comment->body_text))->toBe(str_replace(' ', '', (string) preg_replace('/[A-Z]+-\d+/', '', $expected)), "{$key} {$n}");
        }
    }

    // the reactions of the German demo: who, with which emoji, in which order
    expect($byItem['WEB-47'][0]->reactions->map(fn ($reaction) => [$reaction->emoji, User::query()->find($reaction->user_id)?->handle])->all())->toBe([['👍', 'ida'], ['👍', 'jonas']])
        ->and($byItem['WEB-39'][0]->reactions->pluck('emoji')->all())->toBe(['🎉', '🎉', '🎉'])
        ->and(Comment::query()->whereHas('reactions')->count())->toBe(3);
});

it('attaches English files with the same kinds and types', function () use ($germanIn) {
    $this->seed(EnglishDemoItemsSeeder::class);
    $files = Attachment::query()->with(['media', 'uploader'])->get()->sortBy(fn (Attachment $file) => WorkItem::query()->with('project')->findOrFail($file->attachable_id)->key)->values();
    $owner = fn (Attachment $file) => WorkItem::query()->with('project')->findOrFail($file->attachable_id)->key;

    expect($files->map(fn (Attachment $file) => [$owner($file), $file->kind, $file->filename, $file->mime, $file->uploader->handle])->all())->toBe([
        ['OPS-12', 'file', 'postfix-main.cf.txt', 'text/plain', 'mara'],
        ['WEB-42', 'file', 'hero-draft.png', 'image/png', 'ida'],
        ['WEB-45', 'file', 'service-pages-outline.pdf', 'application/pdf', 'ida'],
    ]);

    foreach ($files as $file) {
        $stored = (string) file_get_contents((string) $file->getFirstMedia('file')?->getPath());

        expect($stored)->toBe(file_get_contents(database_path("seeders/Demo/files/en/{$file->filename}")))
            ->and($file->size)->toBe(strlen($stored))->toBeLessThanOrEqual(4096);
    }

    $png = $files->firstWhere('filename', 'hero-draft.png');
    $pdf = (string) file_get_contents(database_path('seeders/Demo/files/en/service-pages-outline.pdf'));
    $config = (string) file_get_contents(database_path('seeders/Demo/files/en/postfix-main.cf.txt'));
    // the image is the German one under its English name, with its preview
    expect(file_get_contents(database_path('seeders/Demo/files/en/hero-draft.png')))->toBe(file_get_contents(database_path('seeders/Demo/files/hero-entwurf.png')))
        ->and($png?->getFirstMedia('file')?->hasGeneratedConversion('preview'))->toBeTrue()
        // the configuration says the same, its comment in English
        ->and(preg_replace('/^#.*\n/m', '', $config))->toBe(preg_replace('/^#.*\n/m', '', (string) file_get_contents(database_path('seeders/Demo/files/postfix-main.cf.txt'))))
        ->and($germanIn($config))->toBeNull()->and($config)->not->toContain('Auszug')
        // a PDF of one page in English, whose cross-reference table points at its objects
        ->and($pdf)->toStartWith('%PDF-1.4')->toEndWith("%%EOF\n")->toContain('/Count 1', '(Service pages')->not->toContain('Leistung')
        ->and($germanIn($pdf))->toBeNull();

    preg_match('/xref\n0 (\d+)\n((?:\d{10} \d{5} [fn] \n)+)/', $pdf, $xref);
    preg_match('/startxref\n(\d+)\n/', $pdf, $start);
    $offsets = array_slice(array_map(fn (string $line) => (int) substr($line, 0, 10), array_filter(explode("\n", $xref[2]))), 1);

    expect((int) $xref[1])->toBe(count($offsets) + 1)
        ->and(substr($pdf, (int) $start[1], 4))->toBe('xref');
    foreach ($offsets as $index => $offset) {
        expect(substr($pdf, $offset, strlen(($index + 1).' 0 obj')))->toBe(($index + 1).' 0 obj');
    }
});

it('writes no German into item texts', function () use ($germanIn, $itemKeys) {
    $this->seed(EnglishDemoItemsSeeder::class);
    $written = collect([
        ...WorkItem::query()->pluck('title')->all(),
        ...WorkItem::query()->whereNotNull('description_text')->pluck('description_text')->all(),
        ...DB::table('work_item_values')->whereNotNull('value_string')->pluck('value_string')->all(),
        ...DB::table('work_item_values')->whereNotNull('value_text')->pluck('value_text')->all(),
        ...Comment::query()->pluck('body_text')->all(),
        ...Attachment::query()->pluck('filename')->all(),
        ...Event::query()->pluck('changes')->map(fn ($changes) => (string) json_encode($changes, JSON_UNESCAPED_UNICODE))->all(),
    ])->filter(fn (mixed $text) => is_string($text) && $text !== '');
    $german = collect(SharedDemoTexts::germanOnly())->filter(fn (string $text) => mb_strlen($text) > 3);

    expect($written->map($germanIn)->filter()->values()->all())->toBe([])
        ->and($written->filter(fn (string $text) => $german->contains(fn (string $word) => str_contains($text, $word)))->values()->all())->toBe([])
        // the texts of these seeders are each a translation: key by key, none equals its German one
        ->and(array_values(array_filter($itemKeys(), fn (string $key) => German::TEXTS[$key] === English::TEXTS[$key] && ! isset(SharedDemoTexts::KEYS[$key]))))->toBe([])
        ->and(count($itemKeys()))->toBeGreaterThan(100)
        // the probe: the rows read hold the texts of the seeders
        ->and($written->count())->toBeGreaterThan(100)
        ->and($written->contains(English::TEXTS['item.WEB-47.title']))->toBeTrue();
});
