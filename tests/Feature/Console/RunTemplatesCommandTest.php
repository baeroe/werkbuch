<?php

use App\Jobs\RunTemplateJob;
use App\Models\Organization;
use App\Models\Template;
use App\Models\TemplateRun;
use App\Models\User;
use App\Models\WorkItem;
use Illuminate\Contracts\Debug\ExceptionHandler;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

// `app:run-templates` (every minute, routes/console.php): puts a job on the queue for each due template, with `--now`
// runs them in its own process.

beforeEach(function () {
    Storage::fake('local');
    Organization::current()->update(['timezone' => 'Europe/Berlin', 'locale' => 'de']);
    $this->travelTo('2026-11-01 12:00:00');
    Template::factory()->scheduled(['frequency' => 'daily', 'interval' => 1, 'time' => '09:00', 'starts_on' => '2026-10-26', 'ends' => ['type' => 'never']])->create();
    // Monday 09:00:30 in Berlin
    $this->travelTo('2026-11-02 08:00:30');
});

it('runs the due templates in its own process with --now', function () {
    $this->artisan('app:run-templates', ['--now' => true])
        ->expectsOutput('Ran 1 templates.')
        ->assertSuccessful();

    expect(WorkItem::query()->sole()->created_by)->toBe(User::defaultBot()->id)
        ->and(TemplateRun::query()->count())->toBe(1);

    $this->artisan('app:run-templates', ['--now' => true])->expectsOutput('Ran 0 templates.')->assertSuccessful();
});

it('runs only the template it names with --template (K9)', function () {
    $other = Template::factory()->create(['schedule' => Template::query()->sole()->schedule, 'next_run_at' => now()->subMinute()]);
    $first = Template::query()->whereKeyNot($other->id)->sole();

    $this->artisan('app:run-templates', ['--now' => true, '--template' => strtoupper($first->id)])
        ->expectsOutput('Ran 1 templates.')
        ->assertSuccessful();

    expect(TemplateRun::query()->pluck('template_id')->all())->toBe([$first->id]);

    // queued the same way: only the one it names
    config(['queue.default' => 'database']);
    $this->artisan('app:run-templates', ['--template' => $other->id])->expectsOutput('Queued 1 templates.')->assertSuccessful();
    expect(json_decode(DB::table('jobs')->sole()->payload, true)['data']['command'])->toContain($other->id);
});

it('runs the other templates when one fails with --now, reports it and ends with a failure (T8-M1)', function () {
    $first = Template::query()->sole();
    $second = Template::factory()->create(['schedule' => $first->schedule, 'next_run_at' => now()->subMinute()]);
    // the run of the first one crashes
    DB::listen(function (QueryExecuted $query) use ($first): void {
        if (str_starts_with($query->sql, 'insert into `work_items`') && in_array($first->id, $query->bindings, true)) {
            throw new RuntimeException('boom');
        }
    });
    $reported = [];
    $this->app->make(ExceptionHandler::class)->reportable(function (RuntimeException $e) use (&$reported) {
        $reported[] = $e->getMessage();

        return false;
    });

    $this->artisan('app:run-templates', ['--now' => true])
        ->expectsOutput('Ran 2 templates, 1 failed.')
        ->assertFailed();

    expect(WorkItem::query()->sole()->template_id)->toBe($second->id)
        ->and($reported)->toBe(['boom']);
});

it('queues a job per due template without --now', function () {
    config(['queue.default' => 'database']);

    $this->artisan('app:run-templates')->expectsOutput('Queued 1 templates.')->assertSuccessful();

    $job = DB::table('jobs')->sole();
    expect($job->queue)->toBe('default')
        ->and(json_decode($job->payload, true)['displayName'])->toBe(RunTemplateJob::class)
        ->and(WorkItem::query()->count())->toBe(0);

    $this->artisan('queue:work', ['--once' => true, '--queue' => 'default', '--sleep' => 0]);
    expect(WorkItem::query()->count())->toBe(1);
});

it('queues one job per template however often the command runs (K15)', function () {
    config(['queue.default' => 'database']);

    $this->artisan('app:run-templates')->assertSuccessful();
    $this->travelTo('2026-11-02 08:01:30');
    $this->artisan('app:run-templates')->assertSuccessful();

    expect(DB::table('jobs')->count())->toBe(1);
});

it('runs a job of the template with three tries and pauses', function () {
    $job = new RunTemplateJob(Template::query()->sole()->id);

    expect([$job->tries, $job->backoff, $job->uniqueFor, $job->uniqueId(), $job->queue])
        ->toBe([3, [60, 300], 900, Template::query()->sole()->id, 'default']);

    $job->handle();
    expect(WorkItem::query()->count())->toBe(1);
});

it('is planned every minute', function () {
    $this->artisan('schedule:list')->expectsOutputToContain('app:run-templates');
});
