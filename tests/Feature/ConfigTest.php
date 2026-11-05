<?php

use App\Domain\Webhooks\Backoff;
use App\Jobs\DeliverWebhook;
use App\Live\LiveConsumer;
use App\Models\Attachment;
use App\Models\Page;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use App\Notifications\NotificationConsumer;
use App\Search\SearchConsumer;
use App\Webhooks\WebhookBackoff;
use App\Webhooks\WebhookConsumer;
use Illuminate\Support\Env;
use Illuminate\Support\Facades\Http;
use Spatie\WebhookServer\Signer\DefaultSigner;

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
        ->and((require base_path('config/werkbuch.php'))['event_consumers'])->toBe([SearchConsumer::class, NotificationConsumer::class, LiveConsumer::class, WebhookConsumer::class])
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

it('lists the queues in the worker\'s order', function () {
    expect(config('werkbuch.queues'))->toBe(['default', 'live', 'notifications', 'webhooks', 'search', 'media', 'bulk']);
});

it('works every queue in DDEV and the CI, search and media in a worker of their own (they starved behind the events)', function () {
    $workers = function (string $file): array {
        preg_match_all('/queue:(?:listen|work) --queue=([a-z,]+)/', (string) file_get_contents(repo_path($file)), $matches);

        return array_map(fn (string $list): array => explode(',', $list), $matches[1]);
    };

    expect($workers('.ddev/config.yaml'))->toBe([['default', 'live', 'notifications', 'webhooks', 'bulk'], ['search', 'media']])
        // no webhooks yet in the CI (phase 11)
        ->and($workers('.github/workflows/tests.yml'))->toBe([['default', 'live', 'notifications', 'bulk'], ['search', 'media']])
        ->and(array_merge(...$workers('.ddev/config.yaml')))->toEqualCanonicalizing(config('werkbuch.queues'));
});

it('gives SMTP a timeout below the lock wait of the database (T7-M6)', function () {
    setEnv('MAIL_TIMEOUT', null);
    expect((require base_path('config/mail.php'))['mailers']['smtp']['timeout'])->toBe(20);

    setEnv('MAIL_TIMEOUT', '8');
    expect((require base_path('config/mail.php'))['mailers']['smtp']['timeout'])->toBe(8);
    setEnv('MAIL_TIMEOUT', null);
});

it('keeps what lets /broadcasting/auth go without a CSRF token: SameSite lax and no CORS beyond the API (T9-M5)', function () {
    // another site can send no cookie of the session with a POST, and reads no answer of a web route
    expect(config('session.same_site'))->toBe('lax')
        ->and(config('cors.paths'))->toBe(['api/*', 'sanctum/csrf-cookie'])
        ->and(config('cors.supports_credentials'))->toBeFalse();
});

it('lets Reverb take client events from nobody and only the host of APP_URL', function () {
    $previous = env('APP_URL');
    setEnv('APP_URL', 'https://werkbuch.example.com:8443/app');
    $app = (require base_path('config/reverb.php'))['apps']['apps'][0];
    setEnv('APP_URL', is_string($previous) ? $previous : null);

    // the host alone, as a literal (T2-M1): never the scheme, the port or a path
    expect($app['accept_client_events_from'])->toBe('none')
        ->and($app['allowed_origins'])->toBe(['werkbuch.example.com']);
});

it('gives the Reverb connection short timeouts, so a broadcast never hangs a request (K1)', function () {
    expect(config('broadcasting.connections.reverb.client_options'))->toBe(['connect_timeout' => 2, 'timeout' => 3]);
});

it('keeps the search settings', function () {
    $index = fn (string $class): array => config('scout.meilisearch.index-settings')[$class];

    expect(config('scout.prefix'))->toBe('testing_')
        ->and(config('scout.queue'))->toBeFalse()
        ->and(config('scout.after_commit'))->toBeFalse()
        ->and(config('scout.soft_delete'))->toBeFalse()
        ->and(config('scout.identify'))->toBeFalse()
        ->and(config('scout.chunk'))->toBe(['searchable' => 500, 'unsearchable' => 500])
        ->and(array_keys(config('scout.meilisearch.index-settings')))->toBe([WorkItem::class, Page::class, Project::class, User::class])
        ->and($index(WorkItem::class)['searchableAttributes'])->toBe(['key', 'title', 'description', 'comments'])
        ->and($index(WorkItem::class)['filterableAttributes'])->toBe(['project_id', 'archived', 'type_id', 'state_category', 'assignee_id', 'label_ids'])
        ->and($index(WorkItem::class)['rankingRules'])->toBe(['words', 'typo', 'proximity', 'attribute', 'sort', 'exactness', 'updated_at:desc'])
        ->and($index(WorkItem::class)['typoTolerance'])->toBe(['disableOnAttributes' => ['key']])
        ->and($index(Page::class))->toBe([
            'searchableAttributes' => ['title', 'text'],
            'filterableAttributes' => ['project_id'],
            'rankingRules' => ['words', 'typo', 'proximity', 'attribute', 'sort', 'exactness', 'updated_at:desc'],
        ])
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

// every webhook job comes out of WebhookCall::create(), which reads this file; useJob() after create() would throw the
// configured job away (K1), so the job, the queue and the retries stand here and not at the call
it('configures the webhook job of spatie', function () {
    expect(config('webhook-server'))->toBe([
        'queue' => 'webhooks',
        'connection' => null,
        'http_verb' => 'post',
        'proxy' => null,
        'signer' => DefaultSigner::class,
        'signature_header_name' => 'Signature',
        'timestamp_header_name' => 'Timestamp',
        'webhook_id_header_name' => null,
        'headers' => ['Content-Type' => 'application/json'],
        'timeout_in_seconds' => 10,
        'tries' => Backoff::TRIES,
        'backoff_strategy' => WebhookBackoff::class,
        'retryable_status_codes' => null,
        'respect_retry_after' => false,
        'retry_with_jitter' => false,
        'webhook_job' => DeliverWebhook::class,
        'verify_ssl' => true,
        'throw_exception_on_failure' => false,
        'tags' => [],
    ])
        // nothing of the package's file is left out: a new key of a later 4.x stands in ours too
        ->and(array_keys(config('webhook-server')))
        ->toEqualCanonicalizing(array_keys(require base_path('vendor/spatie/laravel-webhook-server/config/webhook-server.php')));
});

it('sends no real HTTP from a feature test (K11)', function () {
    expect(fn () => Http::get('https://receiver.example.com/hook'))->toThrow(RuntimeException::class, 'receiver.example.com');

    Http::fake(['receiver.example.com/*' => Http::response('ok')]);
    expect(Http::get('https://receiver.example.com/hook')->body())->toBe('ok');
});
