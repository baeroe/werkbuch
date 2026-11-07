<?php

use App\Support\TrustedRequests;
use Tests\Support\RepoFiles;

/*
 * The Compose stack (phase 14, task 4a): what docker-compose.yml starts, how the services reach each other and which
 * variables it needs. `docker compose config` and an actual start are checked by hand (task report).
 */

const COMPOSE_BASE_PREFIXES = '/^(PHP_|NGINX_|SSL_|LOG_|APACHE_|HEALTHCHECK_PATH|TRUSTED_PROXY)/';

$compose = fn (): array => RepoFiles::yaml('docker-compose.yml');

/** The default of a `${NAME:-default}` value: the literal for a plain value, null for `${NAME:?…}` (no default). */
$default = function (mixed $value): ?string {
    $value = (string) $value;

    if (preg_match('/^\$\{[A-Z_]+:-(.*)\}$/s', $value, $match) === 1) {
        return $match[1];
    }

    return str_starts_with($value, '${') ? null : $value;
};

$appServices = ['werkbuch', 'reverb', 'queue', 'queue-index', 'queue-webhooks', 'scheduler'];

it('runs the services of spec 8.1 with the workers split like DDEV', function () use ($compose, $appServices) {
    $services = $compose()['services'];

    expect(array_keys($services))->toEqualCanonicalizing([...$appServices, 'mariadb', 'meilisearch']);

    foreach ($appServices as $name) {
        expect($services[$name]['image'])->toBe('${WERKBUCH_IMAGE:-baeroe/werkbuch:latest}');
    }
});

it('uses the pinned MariaDB of the CI and the Meilisearch of DDEV and the CI', function () use ($compose) {
    $services = $compose()['services'];
    $ci = RepoFiles::yaml('.github/workflows/tests.yml')['jobs']['tests']['services'];
    $ddev = RepoFiles::yaml('.ddev/docker-compose.meilisearch.yaml')['services']['meilisearch']['image'];

    expect($services['mariadb']['image'])->toBe($ci['mariadb']['image'])
        ->and($services['mariadb']['image'])->toMatch('/^mariadb:\d+\.\d+\.\d+@sha256:[0-9a-f]{64}$/')
        ->and($services['meilisearch']['image'])->toBe($ddev)
        ->and($services['meilisearch']['image'])->toBe($ci['meilisearch']['image'])
        ->and($services['meilisearch']['image'])->toMatch('/@sha256:[0-9a-f]{64}$/');
});

it('starts MariaDB with a packet size like DDEV and root only from inside', function () use ($compose) {
    $mariadb = $compose()['services']['mariadb'];

    expect($mariadb['command'])->toBe(['--max-allowed-packet=64M'])
        ->and($mariadb['environment']['MARIADB_ROOT_HOST'])->toBe('localhost')
        ->and($mariadb['environment']['MARIADB_DATABASE'])->toBe('werkbuch')
        ->and($mariadb['environment']['MARIADB_USER'])->toBe('werkbuch');
});

it('publishes only werkbuch, on 7740 unless WERKBUCH_PORT says otherwise', function () use ($compose) {
    $services = $compose()['services'];

    expect($services['werkbuch']['ports'])->toBe(['${WERKBUCH_BIND:-0.0.0.0}:${WERKBUCH_PORT:-7740}:8080']);

    foreach ($services as $name => $service) {
        if ($name !== 'werkbuch') {
            expect($service)->not->toHaveKey('ports', "{$name} publishes a port");
        }
    }
});

it('keeps MariaDB, Meilisearch and Reverb on the internal network', function () use ($compose, $appServices) {
    $compose = $compose();

    expect($compose['networks']['backend']['internal'])->toBeTrue();

    foreach (['mariadb', 'meilisearch', 'reverb'] as $name) {
        expect($compose['services'][$name]['networks'])->toBe(['backend']);
    }

    foreach (array_diff($appServices, ['reverb']) as $name) {
        expect($compose['services'][$name]['networks'])->toBe(['default', 'backend']);
    }
});

it('mounts the data volume where the app writes, read-only for Reverb', function () use ($compose, $appServices) {
    $services = $compose()['services'];

    foreach (array_diff($appServices, ['reverb']) as $name) {
        expect($services[$name]['volumes'])->toBe(['werkbuch-data:/var/www/html/storage/app']);
    }

    expect($services['reverb']['volumes'])->toBe(['werkbuch-data:/var/www/html/storage/app:ro'])
        ->and($services['mariadb']['volumes'])->toBe(['mariadb-data:/var/lib/mysql'])
        ->and($services['meilisearch']['volumes'])->toBe(['meili-data:/meili_data'])
        ->and(array_keys($compose()['volumes']))->toEqualCanonicalizing(['werkbuch-data', 'mariadb-data', 'meili-data']);
});

it('starts the workers, the scheduler and Reverb only after werkbuch is healthy, werkbuch only after MariaDB and Meilisearch', function () use ($compose) {
    $services = $compose()['services'];

    expect($services['werkbuch']['depends_on'])->toBe(['mariadb' => ['condition' => 'service_healthy'], 'meilisearch' => ['condition' => 'service_healthy']]);

    foreach (['reverb', 'queue', 'queue-index', 'queue-webhooks', 'scheduler'] as $name) {
        expect($services[$name]['depends_on'])->toBe(['werkbuch' => ['condition' => 'service_healthy']]);
    }
});

it('checks every service\'s health, werkbuch for the host of APP_URL', function () use ($compose) {
    $services = $compose()['services'];

    foreach ($services as $name => $service) {
        expect($service['healthcheck']['test'] ?? null)->not->toBeNull("{$name} has no healthcheck");
    }

    $web = implode(' ', $services['werkbuch']['healthcheck']['test']);

    expect($web)->toContain('${APP_URL#*://}')
        ->and($web)->toContain('Host: ')
        ->and($web)->toContain('http://localhost:8080/up')
        ->and($services['werkbuch']['healthcheck']['start_period'])->toBe('300s')
        ->and($services['reverb']['healthcheck']['test'])->toContain('http://localhost:6001/up')
        ->and($services['queue']['healthcheck']['test'])->toContain('healthcheck-queue')
        ->and($services['queue-index']['healthcheck']['test'])->toContain('healthcheck-queue')
        ->and($services['queue-webhooks']['healthcheck']['test'])->toContain('healthcheck-queue')
        ->and($services['scheduler']['healthcheck']['test'])->toContain('healthcheck-schedule')
        ->and(implode(' ', $services['mariadb']['healthcheck']['test']))->toContain('healthcheck.sh --connect --innodb_initialized')
        ->and(implode(' ', $services['meilisearch']['healthcheck']['test']))->toContain('http://localhost:7700/health');
});

it('stops the workers with SIGTERM and gives a job 30 seconds', function () use ($compose) {
    $services = $compose()['services'];

    foreach (['queue', 'queue-index', 'queue-webhooks'] as $name) {
        expect($services[$name]['stop_signal'])->toBe('SIGTERM')
            ->and($services[$name]['stop_grace_period'])->toBe('30s');
    }

    expect($services['scheduler']['stop_signal'])->toBe('SIGTERM')
        ->and($services['reverb']['stop_signal'])->toBe('SIGTERM');
});

it('gives the admin account only to werkbuch', function () use ($compose, $appServices) {
    $services = $compose()['services'];

    foreach (array_diff($appServices, ['werkbuch']) as $name) {
        expect($services[$name]['environment'])->not->toHaveKey('ADMIN_EMAIL')
            ->and($services[$name]['environment'])->not->toHaveKey('ADMIN_PASSWORD');
    }

    expect($services['werkbuch']['environment']['ADMIN_PASSWORD'])->toBe('${ADMIN_PASSWORD:-}')
        ->and($services['werkbuch']['environment']['ADMIN_EMAIL'])->toStartWith('${ADMIN_EMAIL:?');
});

it('ships no usable password: Compose refuses to start without them', function () use ($compose, $default) {
    $services = $compose()['services'];
    $example = RepoFiles::text('.env.docker.example');

    $required = [
        $services['werkbuch']['environment']['DB_PASSWORD'],
        $services['werkbuch']['environment']['MEILISEARCH_KEY'],
        $services['werkbuch']['environment']['APP_URL'],
        $services['werkbuch']['environment']['ADMIN_EMAIL'],
        $services['mariadb']['environment']['MARIADB_PASSWORD'],
        $services['mariadb']['environment']['MARIADB_ROOT_PASSWORD'],
        $services['meilisearch']['environment']['MEILI_MASTER_KEY'],
    ];

    foreach ($required as $value) {
        expect($value)->toContain(':?')
            ->and($default($value))->toBeNull();
    }

    foreach (['DB_PASSWORD', 'DB_ROOT_PASSWORD', 'MEILISEARCH_KEY'] as $name) {
        expect($example)->toMatch('/^'.$name.'=$/m');
    }
});

it('passes no variable empty that the base image needs set', function () use ($compose, $appServices, $default) {
    $services = $compose()['services'];

    foreach ($appServices as $name) {
        foreach ($services[$name]['environment'] as $key => $value) {
            if (preg_match(COMPOSE_BASE_PREFIXES, (string) $key) === 1) {
                expect($default($value))->not->toBe('', "{$name} passes {$key} empty by default");
            }
        }
    }

    expect($default($services['werkbuch']['environment']['TRUSTED_PROXIES']))->toBe(implode(',', TrustedRequests::PROXIES));
});

it('takes the language of the organization from APP_LOCALE', function () use ($compose) {
    expect($compose()['services']['werkbuch']['environment']['APP_LOCALE'])->toBe('${APP_LOCALE:-en}');
});

it('keeps private webhook targets off and mail on log unless set', function () use ($compose, $default) {
    $environment = $compose()['services']['werkbuch']['environment'];

    expect($default($environment['WEBHOOKS_ALLOW_PRIVATE']))->toBe('false')
        ->and($default($environment['MAIL_MAILER']))->toBe('log')
        ->and($default($environment['API_RATE_LIMIT']))->toBe('600')
        ->and($default($environment['API_SESSION_RATE_LIMIT']))->toBe('3000');
});

it('leaves REVERB_PUBLIC_PORT out: behind the proxy the browser uses the port of APP_URL (T1-M2)', function () use ($compose, $appServices) {
    foreach ($appServices as $name) {
        expect($compose()['services'][$name]['environment'])->not->toHaveKey('REVERB_PUBLIC_PORT');
    }

    expect(RepoFiles::text('.env.docker.example'))->not->toMatch('/^REVERB_PUBLIC_PORT=./m');
});

it('documents every variable of the compose file in .env.docker.example', function () use ($compose) {
    $text = RepoFiles::text('docker-compose.yml');
    $example = RepoFiles::text('.env.docker.example');

    preg_match_all('/\$\{([A-Z_]+)[:}]/', $text, $matches);
    $names = array_unique($matches[1]);

    expect($names)->not->toBeEmpty();

    foreach ($names as $name) {
        expect($example)->toMatch('/^(# )?'.$name.'=/m', "{$name} is missing in .env.docker.example");
    }

    expect($example)->not->toContain('FILESYSTEM_DISK')
        ->and($example)->not->toContain('AWS_')
        ->and($example)->toContain('Never set a variable starting with PHP_, NGINX_, SSL_, LOG_ or TRUSTED_PROXY')
        ->and($example)->toContain('.app-key')
        ->and($compose()['services'])->not->toBeEmpty();
});

it('hardens every werkbuch container with no-new-privileges', function () use ($compose, $appServices) {
    $services = $compose()['services'];

    foreach ($appServices as $name) {
        expect($services[$name]['security_opt'])->toBe(['no-new-privileges:true']);
    }
});

it('runs the workers with the commands of DDEV, one container per queue list', function () use ($compose) {
    $services = $compose()['services'];

    expect($services['reverb']['command'])->toBe('php artisan reverb:start --host=0.0.0.0 --port=6001')
        ->and($services['queue']['command'])->toBe('php artisan queue:work --queue=default,live,notifications,bulk --sleep=1 --tries=3 --max-time=3600 --memory=384')
        ->and($services['queue-index']['command'])->toContain('--queue=search,media')
        ->and($services['queue-webhooks']['command'])->toContain('--queue=webhooks')
        ->and($services['scheduler']['command'])->toBe('php artisan schedule:work');
});
