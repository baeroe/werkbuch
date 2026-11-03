<?php

use App\Models\Attachment;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use App\Search\SearchConsumer;
use Illuminate\Support\Env;

/**
 * Sets an environment variable the way the host would: .env values are loaded by Laravel itself (so the immutable
 * repository would overwrite them on the next boot); clearing them first makes the new value count as external.
 */
function setEnv(string $name, ?string $value): void
{
    Env::getRepository()->clear($name);
    putenv($value === null ? $name : $name.'='.$value);

    if ($value === null) {
        unset($_ENV[$name], $_SERVER[$name]);
    } else {
        $_ENV[$name] = $_SERVER[$name] = $value;
    }
}

// back to the values phpunit.xml forces, never to "unset": later tests would read the developer's .env
afterEach(function () {
    setEnv('ATTACHMENTS_MAX_MB', '25');
    setEnv('WEBHOOKS_ALLOW_PRIVATE', 'false');
});

it('has the documented defaults', function () {
    // phpunit.xml forces the values: no setEnv, no refresh
    expect(config('werkbuch.version'))->toBe('0.1.0-dev')
        ->and(config('werkbuch.attachments_max_mb'))->toBe(25)
        ->and(config('werkbuch.notification_mail_delay'))->toBe(5)
        ->and(config('werkbuch.webhooks_allow_private'))->toBeFalse()
        // the file's default: the tests switch the consumers off (Tests\TestCase)
        ->and((require base_path('config/werkbuch.php'))['event_consumers'])->toBe([SearchConsumer::class])
        ->and(config('werkbuch.event_consumers'))->toBe([])
        ->and(config('werkbuch.rate_limits.api'))->toBe(600)
        ->and(config('werkbuch.rate_limits.mcp'))->toBe(300)
        ->and(config('werkbuch.rate_limits.login_per_ip'))->toBe(20)
        ->and(config('werkbuch.rate_limits.password_reset_per_ip'))->toBe(6)
        ->and(config('werkbuch.rate_limits.password_update_per_ip'))->toBe(10)
        ->and(config('werkbuch.rate_limits.invitation_accept_per_ip'))->toBe(10);
});

it('has the documented defaults whatever .env says', function () {
    // .env is loaded by Laravel; only the forced values of phpunit.xml keep it out of the tests
    $forced = [];

    foreach (simplexml_load_file(repo_path('phpunit.xml'))->php->env as $env) {
        if ((string) $env['force'] === 'true') {
            $forced[(string) $env['name']] = (string) $env['value'];
        }
    }

    expect(array_intersect_key($forced, array_flip(['ATTACHMENTS_MAX_MB', 'WEBHOOKS_ALLOW_PRIVATE'])))
        ->toBe(['ATTACHMENTS_MAX_MB' => '25', 'WEBHOOKS_ALLOW_PRIVATE' => 'false']);
});

it('reads the environment', function () {
    setEnv('ATTACHMENTS_MAX_MB', '50');
    setEnv('WEBHOOKS_ALLOW_PRIVATE', 'true');
    $this->refreshApplication();

    expect(config('werkbuch.attachments_max_mb'))->toBe(50)
        ->and(config('werkbuch.webhooks_allow_private'))->toBeTrue();
});

it('keeps the search settings', function () {
    $index = fn (string $class): array => config('scout.meilisearch.index-settings')[$class];

    expect(config('scout.prefix'))->toBe('testing_')
        ->and(config('scout.queue'))->toBeFalse()
        ->and(config('scout.after_commit'))->toBeFalse()
        ->and(config('scout.soft_delete'))->toBeFalse()
        ->and(config('scout.identify'))->toBeFalse()
        ->and(config('scout.chunk'))->toBe(['searchable' => 500, 'unsearchable' => 500])
        ->and(array_keys(config('scout.meilisearch.index-settings')))->toBe([WorkItem::class, Project::class, User::class])
        ->and($index(WorkItem::class)['searchableAttributes'])->toBe(['key', 'title', 'description', 'comments'])
        ->and($index(WorkItem::class)['filterableAttributes'])->toBe(['project_id', 'archived', 'type_id', 'state_category', 'assignee_id', 'label_ids'])
        ->and($index(WorkItem::class)['rankingRules'])->toBe(['words', 'typo', 'proximity', 'attribute', 'sort', 'exactness', 'updated_at:desc'])
        ->and($index(WorkItem::class)['typoTolerance'])->toBe(['disableOnAttributes' => ['key']])
        ->and($index(Project::class))->toBe([
            'searchableAttributes' => ['identifier', 'former_identifiers', 'name', 'description'],
            'filterableAttributes' => ['id', 'archived'],
            'typoTolerance' => ['disableOnAttributes' => ['identifier', 'former_identifiers']],
        ])
        ->and($index(User::class))->toBe([
            'searchableAttributes' => ['name', 'handle'],
            'filterableAttributes' => ['disabled', 'type'],
            'typoTolerance' => ['disableOnAttributes' => ['handle']],
        ]);
});

it('takes the one default of the attachment limit in both configs (T6-M6)', function () {
    setEnv('ATTACHMENTS_MAX_MB', null);

    expect((require base_path('config/werkbuch.php'))['attachments_max_mb'])->toBe(Attachment::DEFAULT_MAX_MB)
        ->and((require base_path('config/media-library.php'))['max_file_size'])->toBe(Attachment::DEFAULT_MAX_MB * 1024 * 1024);

    setEnv('ATTACHMENTS_MAX_MB', '40');

    expect((require base_path('config/werkbuch.php'))['attachments_max_mb'])->toBe(40)
        ->and((require base_path('config/media-library.php'))['max_file_size'])->toBe(40 * 1024 * 1024);
});
