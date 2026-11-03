<?php

use App\Access\ProjectRole;
use App\Access\RoleAssignments;
use App\Models\Attachment;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use App\RichText\Document;
use App\RichText\RichTextInput;
use App\Support\RichTextRules;
use Illuminate\Support\Facades\DB;
use Tests\Support\RichTextFixtures as F;

/*
 * The rules of saving (plan „Regeln beim Speichern“) as RichTextInput applies them: WEB (public) with Mara as its
 * admin and Lene as a member, OPS (private) without either, Ida in the organization but in no project.
 */

$world = function (): array {
    $mara = User::factory()->create(['name' => 'Mara', 'handle' => 'mara']);
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $lene = memberOf($web, ProjectRole::Member, ['name' => 'Lene', 'handle' => 'lene']);
    $ida = User::factory()->create(['name' => 'Ida', 'handle' => 'ida']);
    $ops = Project::factory()->identifier('OPS')->private()->create();
    $secret = WorkItem::factory()->for($ops)->create(['title' => 'Geheimer Umzug']);
    $own = WorkItem::factory()->for($web)->create(['title' => 'Formular prüfen']);

    return compact('mara', 'web', 'lene', 'ida', 'ops', 'secret', 'own');
};

/** The text as the writer saves it in WEB, JSON under `description_json`, Markdown under `description`. */
$save = function (array $w, array|string $text, ?Document $before = null, ?User $writer = null): ?Document {
    $input = is_string($text) ? ['description' => $text] : ['description_json' => $text];

    return RichTextInput::from($input, 'description', RichTextRules::context($w['web'], $writer ?? $w['mara'], $before));
};

$reference = fn (string $id, ?string $label, string $kind = 'item'): array => ['type' => 'reference', 'attrs' => ['id' => $id, 'label' => $label, 'kind' => $kind]];

it('turns a mention of someone without access into text', function () use ($world, $save) {
    $w = $world();
    $w['lene']->update(['handle' => 'lene-neu']);
    $disabled = memberOf($w['web'], ProjectRole::Member, ['handle' => 'weg', 'disabled_at' => now()]);

    $saved = $save($w, F::doc(F::p(
        F::mention($w['ida']->id, 'ida'), ' ', F::mention($w['lene']->id, 'lene'), ' ',
        F::mention($disabled->id, 'weg'), ' ', F::mention(F::KIRA, null), '!',
    )));

    // the label of a kept mention follows the handle; one nobody may mention is its text, without a label nothing
    expect($saved?->toJson())->toBe(F::doc(F::p('@ida ', F::mention($w['lene']->id, 'lene-neu'), ' @weg !')))
        ->and($save($w, '@ida @lene-neu')?->toJson())->toBe(F::doc(F::p('@ida ', F::mention($w['lene']->id, 'lene-neu'))));
});

it('keeps a mention that was in the text before, also of a person who left the project', function () use ($world, $save) {
    $w = $world();
    $before = Document::fromJson(F::doc(F::p(F::mention($w['lene']->id, 'lene'))));
    app(RoleAssignments::class)->removeFromProject($w['lene'], $w['web']);

    expect($save($w, F::doc(F::p(F::mention($w['lene']->id, 'lene'), ' und ', F::mention($w['ida']->id, 'ida'))), $before)?->toJson())
        ->toBe(F::doc(F::p(F::mention($w['lene']->id, 'lene'), ' und @ida')))
        // Markdown knows the handle only, and keeps it through the account (K8)
        ->and($save($w, '@lene und @ida', $before)?->toJson())->toBe(F::doc(F::p(F::mention($w['lene']->id, 'lene'), ' und @ida')))
        ->and($save($w, '@lene', null)?->toJson())->toBe(F::doc(F::p('@lene')));
});

it('turns a reference to an item the writer does not see into its label', function () use ($world, $save, $reference) {
    $w = $world();

    $saved = $save($w, F::doc(F::p(
        $reference($w['secret']->id, 'OPS-1 Geheimer Umzug'), ' ', $reference(strtoupper($w['own']->id), 'WEB-1'), ' ',
        $reference((string) str()->ulid()->toBase32(), null), $reference(F::PAGE, 'Handbuch', 'page'),
    )));

    // the label came from the writer's own editor; the stored reference keeps none (A229)
    expect($saved?->toJson())->toBe(F::doc(F::p('OPS-1 Geheimer Umzug ', F::reference($w['own']->id), ' Handbuch')))
        ->and($save($w, "OPS-1 [Umzug](item:{$w['secret']->id}) WEB-1")?->toJson())->toBe(F::doc(F::p('OPS-1 Umzug ', F::reference($w['own']->id))))
        ->and($save($w, F::doc(F::p($reference($w['secret']->id, null)))))->toBeNull();
});

it('keeps a hidden reference that was in the text before', function () use ($world, $save) {
    $w = $world();
    $before = Document::fromJson(F::doc(F::p(F::reference($w['secret']->id))));

    expect($save($w, F::doc(F::p(F::reference($w['secret']->id))), $before)?->toJson())->toBe(F::doc(F::p(F::reference($w['secret']->id))))
        ->and($save($w, "[hidden](item:{$w['secret']->id})", $before)?->toJson())->toBe(F::doc(F::p(F::reference($w['secret']->id))));
});

it('refuses an image of another project with 422 at the field', function () use ($world, $save) {
    $w = $world();
    $foreign = Attachment::factory()->create(['project_id' => $w['ops']->id, 'uploaded_by' => $w['mara']->id]);

    expect(invalidOf(fn () => $save($w, F::doc(F::image($foreign->id, 'Plan')))))->toBe(['description_json' => [__('field.rich_text.attachment')]])
        ->and(invalidOf(fn () => $save($w, "![Plan](attachment:{$foreign->id})")))->toBe(['description' => [__('field.rich_text.attachment')]])
        ->and(invalidOf(fn () => $save($w, F::doc(F::p(F::file((string) str()->ulid()->toBase32(), 'x.pdf'))))))->toBe(['description_json' => [__('field.rich_text.attachment')]]);
});

it('refuses an unowned image somebody else uploaded', function () use ($world, $save) {
    $w = $world();
    $lenes = Attachment::factory()->create(['project_id' => $w['web']->id, 'uploaded_by' => $w['lene']->id]);

    expect(invalidOf(fn () => $save($w, F::doc(F::image($lenes->id, null)))))->toBe(['description_json' => [__('field.rich_text.attachment')]])
        ->and($save($w, F::doc(F::image($lenes->id, null)), writer: $w['lene'])?->toJson())->toBe(F::doc(F::image($lenes->id, null)));
});

it('takes an image another text of the project owns', function () use ($world, $save) {
    $w = $world();
    $owned = Attachment::factory()->forItem($w['own'])->create(['uploaded_by' => $w['lene']->id]);

    expect($save($w, F::doc(F::image($owned->id, 'Kopie')))?->toJson())->toBe(F::doc(F::image($owned->id, 'Kopie')));
});

it('fills the file name of a file node from the row', function () use ($world, $save) {
    $w = $world();
    $file = Attachment::factory()->create(['project_id' => $w['web']->id, 'uploaded_by' => $w['mara']->id, 'filename' => 'protokoll.pdf']);

    expect($save($w, F::doc(F::p('Siehe ', F::file($file->id, 'umbenannt.exe'))))?->toJson())->toBe(F::doc(F::p('Siehe ', F::file($file->id, 'protokoll.pdf'))))
        ->and($save($w, "[irgendwas](attachment:{$file->id})")?->toJson())->toBe(F::doc(F::p(F::file($file->id, 'protokoll.pdf'))));
});

it('asks the database a fixed number of times for any number of nodes', function () use ($world, $save) {
    $w = $world();
    $people = collect(range(1, 12))->map(fn (int $n) => memberOf($w['web'], ProjectRole::Member, ['handle' => "person-{$n}"]));
    $items = WorkItem::factory()->for($w['web'])->count(12)->create();
    $files = Attachment::factory()->count(12)->create(['project_id' => $w['web']->id, 'uploaded_by' => $w['mara']->id]);
    $json = fn (int $n) => F::doc(F::p(...$people->take($n)->map(fn (User $user) => F::mention($user->id, $user->handle))->all(),
        ...$items->take($n)->map(fn (WorkItem $item) => F::reference($item->id))->all(),
        ...$files->take($n)->map(fn (Attachment $file) => F::file($file->id, null))->all()));
    $markdown = fn (int $n) => implode(' ', [
        ...$people->take($n)->map(fn (User $user) => "@{$user->handle}")->all(),
        ...$items->take($n)->map(fn (WorkItem $item) => "WEB-{$item->number} [x](item:{$item->id})")->all(),
        ...$files->take($n)->map(fn (Attachment $file) => "[f](attachment:{$file->id})")->all(),
    ]);
    $count = function (Closure $save): int {
        DB::flushQueryLog();
        DB::enableQueryLog();
        $save();
        DB::disableQueryLog();

        return count(DB::getQueryLog());
    };
    // Visibility and the roles are kept for the request: asked once before, so both counts start alike
    $save($w, $json(1));

    expect($count(fn () => $save($w, $json(12))))->toBe($count(fn () => $save($w, $json(1))))
        ->and($count(fn () => $save($w, $markdown(12))))->toBe($count(fn () => $save($w, $markdown(1))))
        ->and($save($w, $json(12))?->mentionedUserIds())->toHaveCount(12)
        ->and($save($w, $markdown(12))?->itemRefs())->toHaveCount(12);
});

it('asks nothing again for the mentions and keys of Markdown that reading it answered (T8-M4)', function () use ($world, $save) {
    $w = $world();
    $save($w, F::doc(F::p('warm')));
    $queries = [];
    DB::listen(function ($query) use (&$queries): void {
        $queries[] = $query->sql;
    });

    $saved = $save($w, "@lene, WEB-{$w['own']->number} und @mara");

    // reading found the accounts by handle and the item by key; the rules ask neither by ID once more
    expect($saved?->mentionedUserIds())->toBe([$w['lene']->id, $w['mara']->id])
        ->and($saved?->itemRefs())->toBe([$w['own']->id])
        ->and(collect($queries)->filter(fn (string $sql) => str_contains($sql, 'from `users` where `users`.`id` in'))->all())->toBe([])
        ->and(collect($queries)->filter(fn (string $sql) => str_contains($sql, 'from `work_items` where `work_items`.`id` in'))->all())->toBe([]);
});
