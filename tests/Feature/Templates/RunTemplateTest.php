<?php

use App\Access\ProjectRole;
use App\Access\RoleAssignments;
use App\Actions\Templates\RunTemplate;
use App\Domain\Properties\FieldType;
use App\Events\EventType;
use App\Models\Attachment;
use App\Models\Event;
use App\Models\Label;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Property;
use App\Models\Template;
use App\Models\TemplateRun;
use App\Models\User;
use App\Models\WorkItem;
use App\Models\WorkItemType;
use App\RichText\Document;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\App;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Tests\Support\RichTextFixtures as F;

// Running a template (spec 4.12, A338, A340, A350, K1, K3, K12, K16): the item is the default bot's through `template`,
// a run that cannot create it stays in the log as `failed` with a sentence in the language of the organisation, and
// only a term of the schedule counts.

beforeEach(function () {
    Storage::fake('local');
    // Monday 2026-11-02, 10:00 in Berlin (KW 45)
    $this->travelTo('2026-11-02 09:00:00');
});

/** WEB with Mara (English) as its admin and lead, Lene as a viewer, and a template of Mara. */
$world = function (array $payload = []): array {
    Organization::current()->update(['timezone' => 'Europe/Berlin', 'locale' => 'de']);
    $mara = User::factory()->create(['name' => 'Mara', 'handle' => 'mara', 'locale' => 'en']);
    $web = Project::factory()->identifier('WEB')->public()->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $lene = memberOf($web, ProjectRole::Viewer, ['name' => 'Lene', 'handle' => 'lene']);
    $template = Template::factory()->create(['project_id' => $web->id, 'created_by' => $mara->id]);
    $template->update(['payload' => [...$template->payload, ...$payload]]);

    return [$web, $mara, $lene, $template];
};

$type = fn (string $name): WorkItemType => WorkItemType::query()->where('name', $name)->firstOrFail();

/** A property the type asks for, at the end of its list. */
$askFor = function (WorkItemType $type, string $key, string $label, bool $required = true): Property {
    $property = Property::factory()->create(['key' => $key, 'label' => $label, 'field_type' => FieldType::Text]);
    $type->typeProperties()->create(['property_id' => $property->id, 'required' => $required, 'position' => $type->typeProperties()->count() + 10]);

    return $property;
};

it('creates the item as the default bot via template, now', function () use ($world) {
    [$web, $mara, , $template] = $world(['start_offset_days' => 0, 'due_offset_days' => 3, 'priority' => 'high']);

    ['run' => $run, 'item' => $item] = RunTemplate::run(actor($mara), $template);

    $event = eventsOf(EventType::WorkItemCreated, $item)->sole();
    expect($item->created_by)->toBe(User::defaultBot()->id)
        ->and($item->template_id)->toBe($template->id)
        ->and($item->title)->toBe('Wartung KW 45')
        ->and([$item->start_date?->toDateString(), $item->due_date?->toDateString(), $item->priority->value])->toBe(['2026-11-02', '2026-11-05', 'high'])
        ->and($item->project_id)->toBe($web->id)
        ->and($item->rich_names)->not->toBeNull()
        ->and($event->actor_id)->toBe(User::defaultBot()->id)
        ->and($event->meta)->toMatchArray(['via' => 'template', 'reason' => 'template', 'on_behalf_of' => $mara->id, 'template' => ['id' => $template->id, 'name' => $template->name]])
        ->and([$run->status, $run->work_item_id, $run->scheduled_for, $run->triggered_by, $run->error])->toBe([TemplateRun::CREATED, $item->id, null, $mara->id, null])
        ->and($run->ran_at->toJSON())->toBe('2026-11-02T09:00:00.000000Z')
        ->and(eventsOf(EventType::TemplateRunFailed))->toHaveCount(0);
});

it('answers the run and the item over REST', function () use ($world) {
    [, $mara, , $template] = $world();
    $this->actingAs($mara);

    $response = $this->postJson("/api/v1/templates/{$template->id}/run")->assertOk();

    $run = TemplateRun::query()->sole();
    $response->assertJsonPath('data.run', [
        'id' => $run->id, 'template_id' => $template->id, 'scheduled_for' => null, 'ran_at' => '2026-11-02T09:00:00.000000Z',
        'status' => 'created', 'work_item_id' => $run->work_item_id, 'error' => null, 'triggered_by' => $mara->id,
    ])->assertJsonPath('data.item.id', $run->work_item_id)->assertJsonPath('data.item.template_id', $template->id)->assertJsonPath('data.item.title', 'Wartung KW 45');
});

it('fails when the assignee is no member any more, logs it in the language of the organisation and stays active', function () use ($world) {
    [$web, $mara, , $template] = $world();
    $kira = memberOf($web, ProjectRole::Member, ['name' => 'Kira', 'handle' => 'kira']);
    $template->update(['payload' => [...$template->payload, 'assignee_id' => $kira->id]]);
    app(RoleAssignments::class)->removeFromProject($kira, $web);
    $this->actingAs($mara);

    $this->postJson("/api/v1/templates/{$template->id}/run")->assertOk()
        ->assertJsonPath('data.item', null)
        ->assertJsonPath('data.run.status', 'failed')
        ->assertJsonPath('data.run.error', __('field.assignee_id.invalid', [], 'de'));

    expect(WorkItem::query()->count())->toBe(0)
        ->and(__('field.assignee_id.invalid', [], 'de'))->not->toBe(__('field.assignee_id.invalid', [], 'en'))
        ->and(App::getLocale())->toBe('en')
        ->and(Template::query()->find($template->id))->not->toBeNull();

    // the next run fails the same way: the template stays as it is
    $again = RunTemplate::run(actor($mara), $template->fresh());
    expect($again['run']->status)->toBe(TemplateRun::FAILED)
        ->and(TemplateRun::query()->count())->toBe(2);
});

it('fails for a refused field of the template', function (Closure $break, string $error) use ($world, $type, $askFor) {
    [$web, $mara, , $template] = $world();
    $break($web, $template, $type, $askFor);

    ['run' => $run, 'item' => $item] = RunTemplate::run(actor($mara), $template->fresh());

    expect($item)->toBeNull()
        ->and([$run->status, $run->work_item_id, $run->error])->toBe([TemplateRun::FAILED, null, $error])
        ->and(WorkItem::query()->where('template_id', $template->id)->count())->toBe(0);
})->with([
    'a disabled type' => [function (Project $web, Template $template, Closure $type) {
        $bug = $type('Bug');
        $web->types()->detach($bug->id);
        $template->update(['payload' => [...$template->payload, 'type_id' => $bug->id]]);
    }, 'Dieser Typ ist im Projekt nicht aktiviert.'],
    'an archived type' => [function (Project $web, Template $template, Closure $type) {
        $bug = $type('Bug');
        $template->update(['payload' => [...$template->payload, 'type_id' => $bug->id]]);
        $bug->update(['archived_at' => now()]);
    }, 'Dieser Typ ist archiviert, es lassen sich keine neuen Items anlegen.'],
    'a missing required property' => [function (Project $web, Template $template, Closure $type, Closure $askFor) {
        $askFor($type('Task'), 'env', 'Umgebung');
    }, 'Pflicht-Property Umgebung fehlt'],
    'missing required properties' => [function (Project $web, Template $template, Closure $type, Closure $askFor) {
        $askFor($type('Task'), 'env', 'Umgebung');
        $askFor($type('Task'), 'note', 'Notiz', false);
        $askFor($type('Task'), 'customer', 'Kunde');
        $askFor($type('Task'), 'host', 'Host');
    }, 'Pflicht-Properties Umgebung, Kunde und Host fehlen'],
    'a deleted parent' => [function (Project $web, Template $template) {
        $epic = WorkItem::factory()->for($web)->epic()->create();
        $template->update(['payload' => [...$template->payload, 'parent_id' => $epic->id]]);
        DB::table('work_items')->where('id', $epic->id)->delete();
    }, 'Das Eltern-Item gibt es nicht.'],
    'a parent that is no epic any more' => [function (Project $web, Template $template) {
        $parent = WorkItem::factory()->for($web)->create();
        $template->update(['payload' => [...$template->payload, 'parent_id' => $parent->id]]);
    }, 'Nur Epics können Kind-Items haben.'],
]);

it('drops a deleted label and a value of a property the type lost, and creates the item', function () use ($world, $type, $askFor) {
    [, $mara, , $template] = $world();
    $kept = Label::factory()->create();
    $gone = Label::factory()->create();
    $env = $askFor($type('Task'), 'env', 'Umgebung', false);
    $template->update(['payload' => [...$template->payload, 'label_ids' => [$kept->id, $gone->id], 'values' => ['env' => 'Prod']]]);
    $gone->delete();
    $type('Task')->typeProperties()->where('property_id', $env->id)->delete();

    ['run' => $run, 'item' => $item] = RunTemplate::run(actor($mara), $template->fresh());

    expect($run->status)->toBe(TemplateRun::CREATED)
        ->and($item?->labels->pluck('id')->all())->toBe([$kept->id])
        ->and($item?->values()->count())->toBe(0);
});

it('writes template.run_failed with the run in the meta', function () use ($world, $type, $askFor) {
    [$web, $mara, , $template] = $world();
    $askFor($type('Task'), 'env', 'Umgebung');

    ['run' => $run] = RunTemplate::run(actor($mara), $template);

    $event = eventsOf(EventType::TemplateRunFailed, $template)->sole();
    expect($event->actor_id)->toBe(User::defaultBot()->id)
        ->and($event->project_id)->toBe($web->id)
        ->and($event->changes)->toBeNull()
        ->and($event->meta)->toBe([
            'via' => 'template', 'reason' => 'template', 'on_behalf_of' => $mara->id,
            'run_id' => $run->id, 'error' => 'Pflicht-Property Umgebung fehlt', 'scheduled_for' => null, 'author_id' => $mara->id,
        ])
        ->and(Event::query()->where('type', EventType::WorkItemCreated)->count())->toBe(0);
});

it('a manual run changes neither run_count nor last_run_at nor next_run_at', function () use ($world) {
    [$web, $mara] = $world();
    $template = Template::factory()->scheduled(['frequency' => 'daily', 'interval' => 1, 'time' => '09:00', 'starts_on' => '2026-11-01', 'ends' => ['type' => 'never']])
        ->create(['project_id' => $web->id, 'created_by' => $mara->id, 'run_count' => 4, 'last_run_at' => '2026-11-01 08:00:00']);
    $before = DB::table('templates')->where('id', $template->id)->first(['run_count', 'last_run_at', 'next_run_at', 'updated_at']);
    $this->travel(5)->minutes();

    RunTemplate::run(actor($mara), $template);

    expect(DB::table('templates')->where('id', $template->id)->first(['run_count', 'last_run_at', 'next_run_at', 'updated_at']))->toEqual($before)
        ->and($before->next_run_at)->toBe('2026-11-03 08:00:00');
});

it('refuses a viewer with 403, hides a private project and refuses an archived one with 409', function () use ($world) {
    [$web, $mara, $lene, $template] = $world();
    $ops = Project::factory()->private()->create();
    $secret = Template::factory()->create(['project_id' => $ops->id]);

    expect(problemOf(fn () => RunTemplate::run(actor($lene), $template))->detail)->toBe(__('problem.detail.templates_members_only'))
        ->and(problemOf(fn () => RunTemplate::run(actor($mara), $secret))->status)->toBe(404);

    $web->update(['archived_at' => now()]);
    $this->actingAs($mara);
    $this->postJson("/api/v1/templates/{$template->id}/run")->assertStatus(409)
        ->assertJsonPath('reason', 'project_archived')
        ->assertJsonPath('detail', __('problem.detail.project_archived', [], 'en'));

    expect(TemplateRun::query()->count())->toBe(0)->and(App::getLocale())->toBe('en');
});

it('copies the images for each run anew', function () use ($world) {
    [, $mara, , $template] = $world();
    $image = Attachment::factory()->forTemplate($template)->stored('Inhalt', 'image/png', 'skizze.png')->create(['uploaded_by' => $mara->id]);
    $template->update(['payload' => [...$template->payload, 'description' => F::doc(F::p(F::text('Plan')), F::image($image->id, 'Skizze'))]]);

    $first = RunTemplate::run(actor($mara), $template->fresh())['item'];
    $second = RunTemplate::run(actor($mara), $template->fresh())['item'];

    $copies = [Document::fromJson((array) $first?->description)->attachmentIds()[0], Document::fromJson((array) $second?->description)->attachmentIds()[0]];
    $rows = Attachment::query()->whereKey($copies)->get()->keyBy('id');
    expect(array_unique([...$copies, $image->id]))->toHaveCount(3)
        ->and($rows[$copies[0]]->attachable_id)->toBe($first?->id)
        ->and($rows[$copies[1]]->attachable_id)->toBe($second?->id)
        ->and($rows->pluck('uploaded_by')->unique()->all())->toBe([User::defaultBot()->id])
        ->and($image->fresh()?->attachable_id)->toBe($template->id);
});

it('reads the rich text and copies the pictures before any lock (K1)', function () use ($world) {
    [, $mara, , $template] = $world();
    $image = Attachment::factory()->forTemplate($template)->stored('Inhalt', 'image/png', 'skizze.png')->create(['uploaded_by' => $mara->id]);
    $template->update(['payload' => [...$template->payload, 'description' => F::doc(F::p(F::mention($mara->id, 'mara')), F::image($image->id, 'Skizze'))]]);

    DB::flushQueryLog();
    DB::enableQueryLog();
    RunTemplate::run(actor($mara), $template->fresh());
    $queries = array_column(DB::getQueryLog(), 'query');
    DB::disableQueryLog();

    $firstLock = array_key_first(array_filter($queries, fn (string $q) => str_ends_with($q, 'for update')));
    $copies = array_keys(array_filter($queries, fn (string $q) => str_starts_with($q, 'insert into `attachments`') || str_starts_with($q, 'insert into `media`')));
    expect($firstLock)->not->toBeNull()
        ->and($copies)->toHaveCount(2)
        ->and(max($copies))->toBeLessThan($firstLock);
});

describe('a term of the schedule', function () use ($world) {
    $daily = ['frequency' => 'daily', 'interval' => 1, 'time' => '09:00', 'starts_on' => '2026-11-01', 'ends' => ['type' => 'never']];
    // 09:00 in Berlin on 2026-11-02
    $term = new DateTimeImmutable('2026-11-02 08:00:00', new DateTimeZone('UTC'));
    $scheduled = function (array $payload = []) use ($world, $daily): array {
        [$web, $mara] = $world($payload);
        test()->travelTo('2026-11-01 12:00:00');
        $template = Template::factory()->scheduled($daily)->create(['project_id' => $web->id, 'created_by' => $mara->id]);
        $template->update(['payload' => [...$template->payload, ...$payload]]);
        test()->travelTo('2026-11-02 08:00:20');

        return [$web, $mara, $template->fresh()];
    };

    it('runs a due term once: counts it, notes it and works out the next', function () use ($scheduled, $term) {
        [, , $template] = $scheduled(['due_offset_days' => 1, 'title' => 'Wartung {date}']);

        ['run' => $run, 'item' => $item] = RunTemplate::execute($template, $term, null) ?? [];

        $fresh = $template->fresh();
        expect([$run->scheduled_for?->toJSON(), $run->triggered_by, $run->status])->toBe(['2026-11-02T08:00:00.000000Z', null, TemplateRun::CREATED])
            ->and([$item?->title, $item?->due_date?->toDateString()])->toBe(['Wartung 2026-11-02', '2026-11-03'])
            ->and(eventsOf(EventType::WorkItemCreated, $item)->sole()->meta)->not->toHaveKey('on_behalf_of')
            ->and([$fresh?->run_count, $fresh?->last_run_at?->toJSON(), $fresh?->next_run_at?->toJSON()])->toBe([1, '2026-11-02T08:00:00.000000Z', '2026-11-03T08:00:00.000000Z'])
            ->and($fresh?->getRawOriginal('updated_at'))->toBe($template->getRawOriginal('updated_at'))
            // the term is done: the same term again finds nothing to do
            ->and(RunTemplate::execute($fresh, $term, null))->toBeNull()
            ->and(TemplateRun::query()->count())->toBe(1);
    });

    it('stores a term given in another zone as UTC (T7-M2)', function () use ($scheduled) {
        [, , $template] = $scheduled();

        ['run' => $run] = RunTemplate::execute($template, new DateTimeImmutable('2026-11-02 09:00:00', new DateTimeZone('Europe/Berlin')), null) ?? [];

        expect($run->scheduled_for?->toJSON())->toBe('2026-11-02T08:00:00.000000Z')
            ->and(TemplateRun::query()->sole()->getRawOriginal('scheduled_for'))->toBe('2026-11-02 08:00:00')
            ->and($template->fresh()?->last_run_at?->toJSON())->toBe('2026-11-02T08:00:00.000000Z');
    });

    it('counts a failed term too', function () use ($scheduled, $term) {
        [, , $template] = $scheduled(['assignee_id' => User::factory()->create()->id]);

        ['run' => $run] = RunTemplate::execute($template, $term, null) ?? [];

        expect($run->status)->toBe(TemplateRun::FAILED)
            ->and(eventsOf(EventType::TemplateRunFailed, $template)->sole()->meta['scheduled_for'])->toBe('2026-11-02T08:00:00.000000Z')
            ->and([$template->fresh()?->run_count, $template->fresh()?->next_run_at?->toJSON()])->toBe([1, '2026-11-03T08:00:00.000000Z']);
    });

    it('does nothing for a term that is not due and works out next_run_at anew', function () use ($scheduled) {
        [, , $template] = $scheduled();
        $template->update(['next_run_at' => '2030-01-01 00:00:00']);

        expect(RunTemplate::execute($template, new DateTimeImmutable('2026-11-02 07:00:00+00:00'), null))->toBeNull()
            ->and($template->fresh()?->next_run_at?->toJSON())->toBe('2026-11-02T08:00:00.000000Z')
            ->and([$template->fresh()?->run_count, TemplateRun::query()->count(), WorkItem::query()->count()])->toBe([0, 0, 0]);

        $template->update(['schedule' => null, 'next_run_at' => '2030-01-01 00:00:00']);
        expect(RunTemplate::execute($template->fresh(), new DateTimeImmutable('2026-11-02 08:00:00+00:00'), null))->toBeNull()
            ->and($template->fresh()?->next_run_at)->toBeNull();
    });

    it('does nothing in an archived project, in one being deleted and for a template that is gone', function () use ($scheduled, $term) {
        [$web, , $template] = $scheduled();

        $web->update(['archived_at' => now()]);
        expect(RunTemplate::execute($template, $term, null))->toBeNull();

        $web->update(['archived_at' => null, 'deleting_at' => now()]);
        expect(RunTemplate::execute($template, $term, null))->toBeNull();

        $web->update(['deleting_at' => null]);
        DB::table('templates')->where('id', $template->id)->delete();
        expect(RunTemplate::execute($template, $term, null))->toBeNull()
            ->and(TemplateRun::query()->count())->toBe(0);
    });

    it('does nothing for a project that went into deletion while the run prepared', function () use ($scheduled, $term) {
        [$web, , $template] = $scheduled();
        $once = false;
        DB::connection()->beforeExecuting(function (string $query) use ($web, &$once): void {
            if (! $once && str_starts_with($query, 'select * from `organization`') && str_ends_with($query, 'lock in share mode')) {
                $once = true;
                DB::table('projects')->where('id', $web->id)->update(['deleting_at' => now()]);
            }
        });

        expect(RunTemplate::execute($template, $term, null))->toBeNull()
            ->and([TemplateRun::query()->count(), WorkItem::query()->count()])->toBe([0, 0]);
    });

    it('gives up after three tries of a template saved again and again (K16)', function () use ($scheduled, $term) {
        [, , $template] = $scheduled();
        $tries = 0;
        DB::connection()->beforeExecuting(function (string $query) use ($template, &$tries): void {
            if (str_starts_with($query, 'select * from `templates`') && str_ends_with($query, 'for update')) {
                $tries++;
                DB::table('templates')->where('id', $template->id)->update(['updated_at' => CarbonImmutable::now()->addMicroseconds($tries)->format('Y-m-d H:i:s.u')]);
            }
        });

        expect(RunTemplate::execute($template, $term, null))->toBeNull()
            ->and($tries)->toBe(RunTemplate::ATTEMPTS)
            ->and(TemplateRun::query()->count())->toBe(0);
    });
});

/** Changes the organisation row (not the copy of the request) the moment the run asks for its shared lock. */
$changeOrganizationAtLock = function (array $columns): void {
    $once = false;
    DB::connection()->beforeExecuting(function (string $query) use ($columns, &$once): void {
        if (! $once && str_starts_with($query, 'select * from `organization`') && str_ends_with($query, 'lock in share mode')) {
            $once = true;
            DB::table('organization')->update($columns);
        }
    });
};

it('starts over with the zone of the organisation as locked (K3)', function () use ($world, $changeOrganizationAtLock) {
    [, $mara, , $template] = $world(['title' => 'Wartung {date}', 'start_offset_days' => 0]);
    // 00:30 of 2026-11-02 in Berlin, still 18:30 of 2026-11-01 in New York
    $this->travelTo('2026-11-01 23:30:00');
    $changeOrganizationAtLock(['timezone' => 'America/New_York']);

    $item = RunTemplate::run(actor($mara), $template)['item'];

    expect([$item?->title, $item?->start_date?->toDateString()])->toBe(['Wartung 2026-11-01', '2026-11-01'])
        ->and(TemplateRun::query()->count())->toBe(1);
});

it('starts over with the language of the organisation as locked (K3)', function () use ($world, $type, $askFor, $changeOrganizationAtLock) {
    [, $mara, , $template] = $world();
    $askFor($type('Task'), 'env', 'Umgebung');
    $changeOrganizationAtLock(['locale' => 'en']);

    expect(RunTemplate::run(actor($mara), $template)['run']->error)->toBe('Required property Umgebung is missing');
});
