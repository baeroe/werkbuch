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
use App\Support\RetryingDatabaseStore;
use App\Webhooks\WebhookBackoff;
use App\Webhooks\WebhookConsumer;
use Illuminate\Support\Env;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
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
    setEnv('API_RATE_LIMIT', '600');
    setEnv('API_SESSION_RATE_LIMIT', '3000');
    setEnv('MCP_RATE_LIMIT', '300');
    setEnv('REVERB_PUBLIC_PORT', '');
    setEnv('SESSION_SECURE_COOKIE', null);
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
        ->and(config('werkbuch.rate_limits.api_session'))->toBe(3000)
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

    expect(array_intersect_key($forced, array_flip(['ATTACHMENTS_MAX_MB', 'WEBHOOKS_ALLOW_PRIVATE', 'API_RATE_LIMIT', 'API_SESSION_RATE_LIMIT', 'MCP_RATE_LIMIT'])))
        ->toBe(['ATTACHMENTS_MAX_MB' => '25', 'WEBHOOKS_ALLOW_PRIVATE' => 'false', 'API_RATE_LIMIT' => '600', 'API_SESSION_RATE_LIMIT' => '3000', 'MCP_RATE_LIMIT' => '300']);
});

it('keeps the limits of the environment of DDEV out of the tests', function () {
    // DDEV's environment reaches $_SERVER, which Laravel reads before the values phpunit.xml forces (Tests\TestCase)
    $case = (string) file_get_contents(repo_path('tests/TestCase.php'));

    foreach (['API_RATE_LIMIT' => '600', 'API_SESSION_RATE_LIMIT' => '3000', 'MCP_RATE_LIMIT' => '300', 'REVERB_PUBLIC_PORT' => ''] as $name => $value) {
        expect($case)->toContain("\$_SERVER['{$name}'] = \$_ENV['{$name}'] ?? '{$value}';");
    }
});

it('reads the environment', function () {
    setEnv('ATTACHMENTS_MAX_MB', '50');
    setEnv('WEBHOOKS_ALLOW_PRIVATE', 'true');
    setEnv('API_RATE_LIMIT', '120');
    setEnv('API_SESSION_RATE_LIMIT', '900');
    setEnv('MCP_RATE_LIMIT', '150');
    setEnv('REVERB_PUBLIC_PORT', '7000');
    $this->refreshApplication();

    expect(config('werkbuch.attachments_max_mb'))->toBe(50)
        ->and(config('werkbuch.webhooks_allow_private'))->toBeTrue()
        ->and(config('werkbuch.rate_limits.api'))->toBe(120)
        ->and(config('werkbuch.rate_limits.api_session'))->toBe(900)
        ->and(config('werkbuch.rate_limits.mcp'))->toBe(150)
        ->and(config('werkbuch.live.port'))->toBe(7000);
});

it('takes secure cookies from the scheme of APP_URL unless SESSION_SECURE_COOKIE says otherwise', function () {
    $previous = env('APP_URL');
    $secure = function (string $url, ?string $override) {
        setEnv('APP_URL', $url);
        setEnv('SESSION_SECURE_COOKIE', $override);

        return (require base_path('config/session.php'))['secure'];
    };

    try {
        expect($secure('https://pm.example.com', null))->toBeTrue()
            ->and($secure('http://localhost:7740', null))->toBeFalse()
            ->and($secure('https://pm.example.com', 'false'))->toBeFalse();
    } finally {
        setEnv('APP_URL', is_string($previous) ? $previous : null);
    }
});

it('points the browser at Reverb\'s own port in DDEV and the CI', function () {
    expect((string) file_get_contents(repo_path('.ddev/config.yaml')))->toContain('- REVERB_PUBLIC_PORT=6001')
        ->and((string) file_get_contents(repo_path('.env.example')))->toContain("\nREVERB_PUBLIC_PORT=6001\n")
        ->and((string) file_get_contents(repo_path('e2e/ci.env')))->toContain("\nREVERB_PUBLIC_PORT=8080\n");
});

it('takes the port of APP_URL in the tests, whatever DDEV sets', function () {
    $parts = parse_url((string) config('app.url'));
    $expected = $parts['port'] ?? (($parts['scheme'] ?? 'https') === 'http' ? 80 : 443);

    expect(config('werkbuch.live.port'))->toBe($expected);
});

it('lists the queues in the worker\'s order', function () {
    expect(config('werkbuch.queues'))->toBe(['default', 'live', 'notifications', 'webhooks', 'search', 'media', 'bulk']);
});

it('works every queue in DDEV, the CI and Compose, search and media and webhooks in workers of their own (they starved behind the events, a hanging receiver holds a worker)', function () {
    $workers = function (string $file): array {
        preg_match_all('/queue:(?:listen|work) --queue=([a-z,]+)/', (string) file_get_contents(repo_path($file)), $matches);

        return array_map(fn (string $list): array => explode(',', $list), $matches[1]);
    };

    expect($workers('.ddev/config.yaml'))->toBe([['default', 'live', 'notifications', 'bulk'], ['search', 'media'], ['webhooks']])
        // `webhooks` in a worker of its own (T16-M5): a receiver that hangs holds it up to 17 s per attempt
        ->and($workers('.github/workflows/tests.yml'))->toBe([['default', 'live', 'notifications', 'bulk'], ['search', 'media'], ['webhooks']])
        ->and($workers('docker-compose.yml'))->toBe([['default', 'live', 'notifications', 'bulk'], ['search', 'media'], ['webhooks']])
        ->and(array_merge(...$workers('docker-compose.yml')))->toEqualCanonicalizing(config('werkbuch.queues'))
        ->and(array_merge(...$workers('.github/workflows/tests.yml')))->toEqualCanonicalizing(config('werkbuch.queues'))
        ->and(array_merge(...$workers('.ddev/config.yaml')))->toEqualCanonicalizing(config('werkbuch.queues'));
});

it('allows private webhook targets in DDEV and the e2e run only (task 10, A373)', function () {
    expect((string) file_get_contents(repo_path('.ddev/config.yaml')))->toContain('- WEBHOOKS_ALLOW_PRIVATE=true')
        ->and((string) file_get_contents(repo_path('e2e/ci.env')))->toContain("\nWEBHOOKS_ALLOW_PRIVATE=true\n")
        ->and((string) file_get_contents(repo_path('.github/workflows/tests.yml')))->toContain('E2E_WEBHOOK_HOST: 127.0.0.1')
        // the tests force them off (phpunit.xml), whatever the environment says
        ->and((string) file_get_contents(repo_path('phpunit.xml')))->toContain('<env name="WEBHOOKS_ALLOW_PRIVATE" value="false" force="true"/>');
});

it('keeps the limits of the API out of the way of e2e in DDEV and the CI (K9)', function () {
    foreach (['.ddev/config.yaml' => ['- API_RATE_LIMIT=6000', '- API_SESSION_RATE_LIMIT=60000'], 'e2e/ci.env' => ["\nAPI_RATE_LIMIT=6000\n", "\nAPI_SESSION_RATE_LIMIT=60000\n"]] as $file => $lines) {
        foreach ($lines as $line) {
            expect((string) file_get_contents(repo_path($file)))->toContain($line);
        }
    }
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

it('gives /mcp no CORS: a browser of another site reads no answer of the MCP server (K15)', function () {
    // HandleCors matches the paths like Request::is()
    expect(Str::is(config('cors.paths'), 'api/v1/organization'))->toBeTrue()
        ->and(Str::is(config('cors.paths'), 'mcp'))->toBeFalse()
        ->and(Str::is(config('cors.paths'), 'mcp/_t'))->toBeFalse();
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

it('counts the throttles in a database store that tries a statement again after a deadlock', function () {
    expect(config('cache.stores.database.driver'))->toBe(RetryingDatabaseStore::DRIVER)
        ->and(config('cache.limiter'))->toBeNull()
        ->and(Cache::store('database')->getStore())->toBeInstanceOf(RetryingDatabaseStore::class);
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
