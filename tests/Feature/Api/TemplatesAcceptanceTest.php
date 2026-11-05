<?php

use App\Access\ProjectRole;
use App\Models\Attachment;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use App\Notifications\NotificationConsumer;
use App\RichText\Document;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;

/*
 * The acceptance of phase 10 over REST (success criterion 3): a token of Mara saves a template "Wartung KW {week}" with
 * a picture and the schedule every Monday at 09:00; the scheduler (`app:run-templates --now`, the clock set) creates its
 * item once per Monday, as the default bot with a copy of the picture, catches up only the last Monday after an outage
 * of three weeks, and a run that the project refuses (the assignee left it) is a failed run the lead and the author hear
 * of in their inbox; the template stays active.
 */

beforeEach(function () {
    Storage::fake('local');
});

$world = function (): array {
    consumers(NotificationConsumer::class);
    Organization::current()->update(['timezone' => 'Europe/Berlin', 'locale' => 'de']);
    $mara = User::factory()->create(['name' => 'Mara', 'handle' => 'mara']);
    $ida = User::factory()->create(['name' => 'Ida', 'handle' => 'ida']);
    // Ida leads WEB, Mara administers it and writes the template, Lene takes its items
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Admin)->member($ida, ProjectRole::Member)
        ->create(['lead_id' => $ida->id]);
    $lene = memberOf($web, ProjectRole::Member, ['name' => 'Lene', 'handle' => 'lene']);

    return ['web' => $web, 'mara' => $mara, 'ida' => $ida, 'lene' => $lene];
};

/** One run of the scheduler in the process at `$at` (UTC). */
$tick = function (string $at): void {
    test()->travelTo($at);
    test()->artisan('app:run-templates', ['--now' => true])->assertSuccessful();
};

/** The items of the template, oldest first. */
$items = fn (): array => WorkItem::query()->orderBy('number')->pluck('title')->all();

it('runs a template with a picture every Monday once, catches up the last one and fails loud', function () use ($world, $tick, $items) {
    $w = $world();
    $mara = apiToken($w['mara'], ['read', 'write']);
    $bot = User::defaultBot();

    // Sunday 2026-11-01: the picture, then the template that shows it
    $this->travelTo('2026-11-01 12:00:00');
    $picture = $this->withToken($mara)->post('/api/v1/attachments', [
        'project_id' => 'WEB', 'kind' => 'inline', 'file' => UploadedFile::fake()->image('skizze.png', 40, 30),
    ], ['Accept' => 'application/json'])->assertCreated()->json('data.id');

    $template = $this->withToken($mara)->postJson('/api/v1/projects/WEB/templates', [
        'name' => 'Wartung',
        'payload' => [
            'title' => 'Wartung KW {week}',
            'description' => "Server prüfen\n\n![x](attachment:{$picture})",
            'assignee_id' => $w['lene']->id,
        ],
        'schedule' => [
            'frequency' => 'weekly', 'interval' => 1, 'weekdays' => [1], 'time' => '09:00',
            'starts_on' => '2026-10-26', 'ends' => ['type' => 'never'], 'paused' => false,
        ],
    ])->assertCreated()
        ->assertJsonPath('data.next_run_at', '2026-11-02T08:00:00.000000Z')
        ->json('data');
    // the template owns the picture now
    expect(Attachment::query()->findOrFail($picture)->only(['attachable_type', 'attachable_id']))
        ->toBe(['attachable_type' => 'template', 'attachable_id' => $template['id']]);

    // Monday 09:00:30 in Berlin: one item, of the default bot, with a copy of the picture
    $tick('2026-11-02 08:00:30');
    $item = WorkItem::query()->sole();
    expect([$item->title, $item->created_by, $item->assignee_id, $item->template_id])
        ->toBe(['Wartung KW 45', $bot->id, $w['lene']->id, $template['id']])
        ->and($bot->name)->toBe('Automation');
    [$copy] = Document::fromJson((array) $item->description)->attachmentIds();
    $copied = Attachment::query()->findOrFail($copy);
    expect($copy)->not->toBe($picture)
        ->and([$copied->attachable_type, $copied->attachable_id, $copied->kind, $copied->filename])->toBe(['work_item', $item->id, 'inline', 'skizze.png'])
        ->and(Storage::disk('local')->exists((string) $copied->getFirstMedia('file')?->getPathRelativeToRoot()))->toBeTrue()
        // the template keeps its own
        ->and(Attachment::query()->findOrFail($picture)->attachable_id)->toBe($template['id']);

    forgetApiAuth();
    $this->withToken($mara)->getJson("/api/v1/work-items/{$item->key}/history")->assertOk()
        ->assertJsonPath('data.0.type', 'work_item.created')
        ->assertJsonPath('data.0.actor_id', $bot->id)
        ->assertJsonPath('data.0.via', 'template');

    // the same minute and an hour later: no second item
    $tick('2026-11-02 08:00:40');
    $tick('2026-11-02 09:00:00');
    expect($items())->toBe(['Wartung KW 45']);

    // three weeks without a scheduler (9, 16, 23 November missed): one item, for the last Monday
    $tick('2026-11-25 12:00:00');
    expect($items())->toBe(['Wartung KW 45', 'Wartung KW 48']);
    $tick('2026-11-25 12:01:00');
    expect($items())->toBe(['Wartung KW 45', 'Wartung KW 48']);

    // Lene leaves WEB: the next Monday is a failed run, and the lead and the author hear of it
    forgetApiAuth();
    $this->withToken($mara)->deleteJson("/api/v1/projects/WEB/members/{$w['lene']->id}")->assertNoContent();
    $tick('2026-11-30 08:00:30');
    expect($items())->toBe(['Wartung KW 45', 'Wartung KW 48']);

    $error = __('field.assignee_id.invalid', [], 'de');
    foreach (['mara', 'ida'] as $person) {
        forgetApiAuth();
        $inbox = $this->withToken(apiToken($w[$person], ['read']))->getJson('/api/v1/notifications?per_page=100')->assertOk()
            // the newest
            ->assertJsonPath('data.0.event', 'template_run_failed')
            ->assertJsonPath('data.0.project_id', $w['web']->id)
            ->assertJsonPath('data.0.work_item_id', null)
            ->assertJsonPath('data.0.actor_id', $bot->id)
            ->assertJsonPath('data.0.read_at', null)
            ->assertJsonPath('data.0.data', ['template_id' => $template['id'], 'error' => $error])
            ->json('data');
        // once each; Ida as the lead heard of both items besides
        expect(collect($inbox)->countBy('event')->all())
            ->toBe($person === 'ida' ? ['template_run_failed' => 1, 'item_created' => 2] : ['template_run_failed' => 1]);
    }
    // Lene is no member any more: she hears nothing of it
    forgetApiAuth();
    $this->withToken(apiToken($w['lene'], ['read']))->getJson('/api/v1/notifications?per_page=100')->assertOk()
        ->assertJsonMissing(['event' => 'template_run_failed']);

    // the log names every run, newest first; the template stays active
    forgetApiAuth();
    $runs = $this->withToken($mara)->getJson("/api/v1/templates/{$template['id']}/runs")->assertOk()
        ->assertJsonPath('meta.total', 3)
        ->json('data');
    $made = WorkItem::query()->orderBy('number')->pluck('id')->all();
    expect(array_map(fn (array $run) => [$run['scheduled_for'], $run['status'], $run['work_item_id'], $run['error'], $run['triggered_by']], $runs))->toBe([
        ['2026-11-30T08:00:00.000000Z', 'failed', null, $error, null],
        ['2026-11-23T08:00:00.000000Z', 'created', $made[1], null, null],
        ['2026-11-02T08:00:00.000000Z', 'created', $made[0], null, null],
    ]);
    $this->getJson("/api/v1/templates/{$template['id']}")->assertOk()
        ->assertJsonPath('data.schedule.paused', false)
        ->assertJsonPath('data.run_count', 3)
        ->assertJsonPath('data.last_run_at', '2026-11-30T08:00:00.000000Z')
        ->assertJsonPath('data.next_run_at', '2026-12-07T08:00:00.000000Z');
});
