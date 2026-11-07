<?php

use App\Mcp\Resources\DocReference;
use App\Models\Attachment;
use Illuminate\Filesystem\Filesystem;
use Symfony\Component\Process\Process;
use Tests\Support\RepoFiles;

// what serversideup v5.0.4 (php 8.4.27-fpm-nginx-trixie) brings without install-php-extensions (`php -m` of the base)
$baseExtensions = ['opcache', 'pcntl', 'pdo_mysql', 'pdo_pgsql', 'redis', 'zip'];

$baseImages = [
    'node:24.22.0-trixie-slim@sha256:a6155384446670e9719bdc4fd0ebe4d4b29fb32a8d6aa523da3547a6cfbcf22c',
    'serversideup/php:8.4.27-fpm-nginx-trixie-v5.0.4@sha256:c91d4ff3cb30582078050735b42e873a196d60a406a68cff14bda79e3b5fff56',
];

/** The instructions of the Dockerfile, continuation lines joined and comments dropped, optionally of one stage only. */
$instructions = function (?string $stage = null): array {
    $joined = (string) preg_replace('/\\\\\r?\n\s*/', ' ', RepoFiles::text('Dockerfile'));
    $all = [];
    $current = null;

    foreach (explode("\n", $joined) as $line) {
        $line = trim($line);

        if ($line === '' || str_starts_with($line, '#')) {
            continue;
        }
        if (preg_match('/^FROM\s.*\sAS\s+(\S+)$/i', $line, $match) === 1) {
            $current = $match[1];
        }
        if ($stage === null || $current === $stage) {
            $all[] = $line;
        }
    }

    expect($all)->not->toBeEmpty('the Dockerfile has no stage '.($stage ?? ''));

    return $all;
};

/** The non-comment lines of .dockerignore. */
$ignoreLines = function (): array {
    return array_values(array_filter(
        array_map('trim', explode("\n", RepoFiles::text('.dockerignore'))),
        fn (string $line) => $line !== '' && ! str_starts_with($line, '#'),
    ));
};

/** Whether Docker leaves a path of the repository out of the build context: the last pattern that matches it or a parent wins. */
$ignored = function (string $path) use ($ignoreLines): bool {
    $result = false;
    $parts = explode('/', $path);

    foreach ($ignoreLines() as $line) {
        $negated = str_starts_with($line, '!');
        $pattern = ltrim($negated ? substr($line, 1) : $line, '/');
        $regex = '#^'.strtr(preg_quote($pattern, '#'), ['\*\*/' => '(?:.*/)?', '\*\*' => '.*', '\*' => '[^/]*', '\?' => '[^/]']).'$#';

        for ($i = count($parts); $i >= 1; $i--) {
            if (preg_match($regex, implode('/', array_slice($parts, 0, $i))) === 1) {
                $result = ! $negated;
                break;
            }
        }
    }

    return $result;
};

/** The entries of the map that writes the logged path, in order: [source pattern, value], quotes kept. */
$loggedUriMap = function (): array {
    $http = RepoFiles::text('docker/nginx/conf.d/00-werkbuch.conf');
    expect(preg_match('/^map \$request_uri \$werkbuch_logged_uri \{\n(.*?)\n\}$/ms', $http, $map))->toBe(1);
    $entries = [];

    foreach (array_filter(array_map('trim', explode("\n", $map[1]))) as $line) {
        expect(preg_match('/^("[^"]*"|\S+)\s+("[^"]*"|\S+);$/', $line, $entry))->toBe(1, "unreadable map line: {$line}");
        $entries[] = [$entry[1], $entry[2]];
    }

    return $entries;
};

/** The files below docker/nginx, as paths relative to the repository. */
$nginxFiles = function (): array {
    $root = repo_path('docker/nginx');
    expect(is_dir($root))->toBeTrue('docker/nginx is missing');
    $files = [];

    foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS)) as $file) {
        $files[] = 'docker/nginx/'.substr($file->getPathname(), strlen($root) + 1);
    }

    expect($files)->not->toBeEmpty();

    return $files;
};

it('pins both base images by version and digest, on glibc', function () use ($instructions, $baseImages) {
    $froms = array_values(array_filter($instructions(), fn (string $line) => preg_match('/^FROM\s/i', $line) === 1));
    $refs = array_map(fn (string $line) => preg_replace('/^FROM\s+(?:--platform=\S+\s+)?(\S+).*$/i', '$1', $line), $froms);

    expect($refs)->toHaveCount(2);
    foreach ($refs as $ref) {
        expect($ref)->toMatch('/^[a-z0-9\/._-]+:[\w.-]+@sha256:[0-9a-f]{64}$/');
        expect($ref)->not->toContain('alpine');
    }
    expect($refs)->toBe($baseImages);
});

it('builds the assets with pnpm from corepack, never npm', function () use ($instructions) {
    $assets = $instructions('assets');
    $installs = array_values(array_filter($assets, fn (string $line) => str_contains($line, 'pnpm install')));

    expect(implode("\n", $assets))->toContain('corepack enable');
    expect($installs)->toHaveCount(1);
    expect($installs[0])->toContain('pnpm install --frozen-lockfile');
    expect($installs[0])->not->toContain('--filter');
    expect($assets)->toContain('RUN pnpm build');

    foreach ($instructions() as $line) {
        expect($line)->not->toMatch('/(?<![\w-])npm\b/');
        expect($line)->not->toMatch('/(?<![\w-])npx\b/');
    }
});

it('installs the PHP extensions the code needs and checks the platform', function () use ($instructions) {
    $app = $instructions('app');
    $composer = array_values(array_filter($app, fn (string $line) => str_contains($line, 'composer install')));

    expect($app)->toContain('RUN install-php-extensions intl bcmath gd exif');
    expect($composer)->toHaveCount(1);

    $check = strpos($composer[0], 'composer check-platform-reqs --no-dev');
    $install = strpos($composer[0], 'composer install');
    expect($check)->toBeInt();
    expect($check)->toBeLessThan($install);
});

it('has every extension the CI tests with', function () use ($instructions, $baseExtensions) {
    $line = collect($instructions('app'))->first(fn (string $l) => str_starts_with($l, 'RUN install-php-extensions '));
    $installed = [...preg_split('/\s+/', trim(substr((string) $line, strlen('RUN install-php-extensions ')))), ...$baseExtensions];

    $ci = [];
    foreach (RepoFiles::yaml('.github/workflows/tests.yml')['jobs'] as $job) {
        foreach ($job['steps'] ?? [] as $step) {
            if (str_contains($step['uses'] ?? '', 'shivammathur/setup-php')) {
                $ci = [...$ci, ...array_map('trim', explode(',', $step['with']['extensions']))];
            }
        }
    }

    expect($ci)->not->toBeEmpty('tests.yml sets up PHP without a list of extensions');
    foreach (array_unique($ci) as $extension) {
        expect($installed)->toContain($extension);
    }
    // spatie/image reads the orientation of a photo
    expect($installed)->toContain('exif');
});

it('lets uploads up to ATTACHMENTS_MAX_MB through PHP and nginx and gives PHP 512 MB', function () {
    $upload = RepoFiles::bytes(RepoFiles::dockerfileEnv('PHP_UPLOAD_MAX_FILE_SIZE'));
    $post = RepoFiles::bytes(RepoFiles::dockerfileEnv('PHP_POST_MAX_SIZE'));

    expect($upload)->toBeGreaterThanOrEqual(Attachment::DEFAULT_MAX_MB * 1024 ** 2);
    expect($post)->toBeGreaterThan($upload);
    expect(RepoFiles::bytes(RepoFiles::dockerfileEnv('NGINX_CLIENT_MAX_BODY_SIZE')))->toBeGreaterThanOrEqual($post);
    expect(RepoFiles::bytes(RepoFiles::dockerfileEnv('PHP_MEMORY_LIMIT')))->toBe(512 * 1024 ** 2);
    expect(RepoFiles::dockerfileEnv('APP_ENV'))->toBe('production');
    expect(RepoFiles::dockerfileEnv('APP_DEBUG'))->toBe('false');
    expect(RepoFiles::dockerfileEnv('TRUSTED_PROXY'))->toBe('off');
    expect(RepoFiles::dockerfileEnv('AUTORUN_ENABLED'))->toBe('false');
});

it('sends to Reverb inside the stack and works the queues of the database', function () {
    expect(RepoFiles::dockerfileEnv('REVERB_HOST'))->toBe('reverb');
    expect(RepoFiles::dockerfileEnv('REVERB_PORT'))->toBe('6001');
    expect(RepoFiles::dockerfileEnv('REVERB_SERVER_PORT'))->toBe('6001');
    expect(RepoFiles::dockerfileEnv('REVERB_SCHEME'))->toBe('http');
    expect(RepoFiles::dockerfileEnv('QUEUE_CONNECTION'))->toBe('database');
    expect(RepoFiles::dockerfileEnv('BROADCAST_CONNECTION'))->toBe('reverb');
    expect(RepoFiles::dockerfileEnv('SCOUT_DRIVER'))->toBe('meilisearch');
    expect(RepoFiles::dockerfileEnv('MEILISEARCH_HOST'))->toBe('http://meilisearch:7700');
    expect(RepoFiles::dockerfileEnv('LOG_CHANNEL'))->toBe('stderr');
    expect(RepoFiles::dockerfileEnv('APP_NAME'))->toBe('werkbuch');
});

it('ships the docs the MCP references read', function () use ($instructions, $ignoreLines, $ignored) {
    $pages = [];
    foreach (glob(repo_path('app/Mcp/Resources/*.php')) ?: [] as $file) {
        $class = 'App\\Mcp\\Resources\\'.basename($file, '.php');
        $reflection = new ReflectionClass($class);

        if ($reflection->isSubclassOf(DocReference::class) && ! $reflection->isAbstract()) {
            $pages[] = (string) $reflection->getMethod('page')->invoke($reflection->newInstance());
        }
    }

    expect($pages)->not->toBeEmpty();
    $copies = array_values(array_filter($instructions('app'), fn (string $line) => str_starts_with($line, 'COPY ')));

    foreach (array_unique($pages) as $page) {
        expect($ignoreLines())->toContain("!docs/en/{$page}");
        expect($ignored("docs/en/{$page}"))->toBeFalse("docs/en/{$page} stays out of the build context");
        expect(collect($copies)->contains(fn (string $copy) => in_array("docs/en/{$page}", preg_split('/\s+/', $copy), true)))
            ->toBeTrue("the Dockerfile copies no docs/en/{$page}");
    }
});

it('ships Stoplight with its license', function () use ($instructions, $ignored) {
    expect(is_file(repo_path('public/vendor/stoplight-elements/8.4.2/LICENSE')))->toBeTrue();
    expect($ignored('public/vendor/stoplight-elements/8.4.2/LICENSE'))->toBeFalse();
    expect($ignored('public/vendor/stoplight-elements/8.4.2/web-components.min.js'))->toBeFalse();
    expect($instructions('app'))->toContain('COPY public ./public');
});

it('keeps secrets, dependencies and local files out of the build context', function () use ($ignoreLines, $ignored) {
    foreach (['.env', '.env.*', '**/node_modules', 'vendor', 'storage', 'bootstrap/cache/*.php', '.git', '.ddev', '.superpowers', '.claude', 'e2e', 'tests', 'coverage', 'prototypes/*/*'] as $line) {
        expect($ignoreLines())->toContain($line);
    }

    foreach (['.env', '.env.docker', 'node_modules/vite/package.json', 'prototypes/clickdummy/node_modules/react/index.js', 'docs/node_modules/vitepress/package.json',
        'vendor/autoload.php', 'storage/app/.app-key', 'bootstrap/cache/config.php', '.git/HEAD', '.ddev/config.yaml', '.superpowers/sdd/x.md',
        '.claude/settings.json', 'e2e/helpers.ts', 'tests/Pest.php', 'coverage/index.html', 'prototypes/clickdummy/src/main.tsx', 'docs/en/setup.md'] as $path) {
        expect($ignored($path))->toBeTrue("{$path} reaches the build context");
    }
    foreach (['prototypes/clickdummy/package.json', 'docs/package.json', 'package.json', 'pnpm-lock.yaml', 'composer.lock', 'app/Models/User.php', 'resources/js/app.tsx'] as $path) {
        expect($ignored($path))->toBeFalse("{$path} is missing in the build context");
    }
});

it('keeps the code read-only for PHP, only storage and bootstrap/cache writable', function () use ($instructions) {
    $app = $instructions('app');
    foreach ($app as $line) {
        expect($line)->not->toContain('--chown');
    }

    $users = array_keys(array_filter($app, fn (string $line) => str_starts_with($line, 'USER ')));
    $last = end($users);
    expect($app[$last])->toBe('USER www-data');
    expect($app[$last - 1])->toStartWith('RUN ');

    $commands = array_map('trim', explode('&&', substr($app[$last - 1], 4)));
    $index = fn (string $start) => collect($commands)->search(fn (string $c) => str_starts_with($c, $start));
    $debug = ['"$PHP_INI_DIR/conf.d/zzz-serversideup-docker-php-debug.ini"', '/usr/local/etc/php-fpm.d/zzz-docker-php-serversideup-fpm-debug.conf', '/usr/local/etc/php-fpm.conf'];

    $steps = [
        $index('chown root:root /var/www .'),
        $index('chmod 755 /var/www .'),
        $index('chown -R root:root '),
        $index('chmod -R a+rX,go-w '),
        $index('chown root:root "$PHP_INI_DIR'),
        $index('chmod 644 "$PHP_INI_DIR'),
        $index('chown -R www-data:www-data '),
    ];
    foreach ($steps as $step) {
        expect($step)->toBeInt();
    }
    expect($steps)->toBe(array_values(array_unique($steps)));
    expect($steps)->toBe(collect($steps)->sort()->values()->all());
    expect($commands[array_key_last($commands)])->toBe('chown -R www-data:www-data storage bootstrap/cache');
    // our server config belongs to root: www-data could otherwise swap security.conf or add a location
    expect($commands)->toContain('chown root:root /etc/nginx/server-opts.d')
        ->and($commands)->toContain('chmod 755 /etc/nginx/server-opts.d');

    foreach ([$steps[2], $steps[3]] as $step) {
        $words = preg_split('/\s+/', $commands[$step]);
        foreach (['app', 'vendor', 'public', 'config', 'routes'] as $folder) {
            expect($words)->toContain($folder);
        }
    }
    foreach ([$steps[4], $steps[5]] as $step) {
        $words = preg_split('/\s+/', $commands[$step]);
        foreach ($debug as $file) {
            expect($words)->toContain($file);
        }
    }
});

it('keeps the Composer cache out of the image', function () use ($instructions) {
    $composer = collect($instructions('app'))->first(fn (string $line) => str_contains($line, 'composer install'));

    expect($composer)->toStartWith('RUN --mount=type=cache,target=/composer/cache ');
});

it('hides the arguments in stack traces and keeps the session upload progress off', function () use ($instructions) {
    $ini = parse_ini_string(RepoFiles::text('docker/php/zz-werkbuch.ini'), false, INI_SCANNER_RAW);

    expect($ini)->toBeArray();
    expect($ini['zend.exception_ignore_args'] ?? null)->toBe('On');
    expect($ini['session.upload_progress.enabled'] ?? null)->toBe('Off');
    expect($ini['expose_php'] ?? null)->toBe('Off');
    expect($instructions('app'))->toContain('COPY --chmod=644 docker/php/zz-werkbuch.ini /usr/local/etc/php/conf.d/zz-werkbuch.ini');
});

it('logs no query string, no referer, no reset token and no health check of its own, but the forwarded address', function () use ($loggedUriMap) {
    $http = RepoFiles::text('docker/nginx/conf.d/00-werkbuch.conf');
    $server = RepoFiles::text('docker/nginx/server-opts.d/werkbuch.conf');

    expect(preg_match("/log_format\s+werkbuch\s+'([^;]*)';/", $http, $match))->toBe(1);
    $format = $match[1];
    expect($format)->not->toMatch('/\$request(?!_)/');
    expect($format)->not->toContain('$args');
    expect($format)->not->toContain('$query_string');
    expect($format)->not->toContain('$http_referer');
    expect($format)->toContain('$werkbuch_logged_uri');
    expect($format)->toContain('$http_x_forwarded_for');

    // the whole map, line by line: a catch-all that let the query or a decoded path through would leak signatures
    expect($loggedUriMap())->toBe([
        ['~*^/reset-password/', '/reset-password/...'],
        ['~*^/api/mcp/uploads/', '/api/mcp/uploads/...'],
        ['"~^(?<werkbuch_path>[^?%]*)%"', '"${werkbuch_path}%..."'],
        ['"~^(?<werkbuch_path>[^?]*)"', '$werkbuch_path'],
    ]);

    expect(preg_match('/map "\$remote_addr \$request_uri" \$werkbuch_loggable \{([^}]*)\}/', $http, $loggable))->toBe(1);
    expect($loggable[1])->toContain('127\.0\.0\.1');
    expect($loggable[1])->toContain('::1');
    expect($loggable[1])->toContain(' /up');
    expect($loggable[1])->toMatch('/default\s+\$loggable;/');

    expect($server)->toMatch('#^access_log /dev/stdout werkbuch if=\$werkbuch_loggable;$#m');
});

it('masks the log by what the regexes of the map leave of each path', function () use ($loggedUriMap) {
    $rules = $loggedUriMap();
    expect($rules)->toHaveCount(4);

    // nginx's map: the first regex that matches wins, its captures fill the value
    $logged = function (string $uri) use ($rules): string {
        foreach ($rules as [$pattern, $value]) {
            expect(preg_match('/^(~\*?)(.+)$/', trim($pattern, '"'), $regex))->toBe(1, "{$pattern} is no regex");
            if (preg_match('#'.$regex[2].'#'.($regex[1] === '~*' ? 'i' : ''), $uri, $match) === 1) {
                return strtr(trim($value, '"'), ['${werkbuch_path}' => $match['werkbuch_path'] ?? '', '$werkbuch_path' => $match['werkbuch_path'] ?? '']);
            }
        }

        return $uri;
    };

    expect($logged('/invitations/01abc?expires=1&signature=SIG'))->toBe('/invitations/01abc')
        ->and($logged('/reset-password/TOKEN?email=x'))->toBe('/reset-password/...')
        ->and($logged('/Reset-Password/TOKEN'))->toBe('/reset-password/...')
        ->and($logged('/%72eset-password/TOKEN'))->toBe('/%...')
        ->and($logged('/api/mcp/%75ploads/TOKEN'))->toBe('/api/mcp/%...')
        ->and($logged('/api/mcp/uploads/TOKEN'))->toBe('/api/mcp/uploads/...')
        ->and($logged('/items/WEB-47'))->toBe('/items/WEB-47')
        ->and($logged('/up'))->toBe('/up');
});

it('passes /app/ on to Reverb, resolved at request time, and never Reverb\'s HTTP API', function () use ($nginxFiles) {
    $server = RepoFiles::text('docker/nginx/server-opts.d/werkbuch.conf');

    expect($server)->toContain('location ^~ /app/ {');
    expect($server)->toContain('proxy_set_header Upgrade $http_upgrade;');
    expect($server)->toContain('proxy_set_header Connection "upgrade";');
    expect($server)->toMatch('/^resolver 127\.0\.0\.11\b/m');
    expect($server)->toContain('proxy_pass $werkbuch_reverb;');
    expect($server)->toMatch('/^resolver_timeout [1-5]s;$/m');

    foreach ($nginxFiles() as $file) {
        expect(RepoFiles::text($file))->not->toContain('proxy_pass http://reverb');
        expect(RepoFiles::text($file))->not->toMatch('#^\s*location\b[^{]*/apps#m');
    }
});

it('leaves HSTS to the TLS proxy', function () use ($instructions, $nginxFiles) {
    foreach ($nginxFiles() as $file) {
        expect(RepoFiles::text($file))->not->toContain('Strict-Transport-Security');
    }

    $security = RepoFiles::text('docker/nginx/server-opts.d/security.conf');
    expect($security)->toContain('add_header X-Content-Type-Options');
    expect($security)->toContain('location ~ /\.');
    expect($instructions('app'))->toContain('COPY --chmod=644 docker/nginx/server-opts.d/ /etc/nginx/server-opts.d/');
});

/** The temporary folders of the entrypoint runs, removed after each test. */
$entrypointDirs = new ArrayObject;

afterEach(function () use ($entrypointDirs) {
    foreach ($entrypointDirs as $dir) {
        (new Filesystem)->deleteDirectory($dir);
    }
    $entrypointDirs->exchangeArray([]);
});

/** A new temporary folder for an entrypoint run, with bin/ for the fake php. */
$entrypointDir = function () use ($entrypointDirs): string {
    $dir = sys_get_temp_dir().'/werkbuch-entrypoint-'.bin2hex(random_bytes(6));
    mkdir($dir.'/bin', 0777, true);
    $entrypointDirs[] = $dir;

    return $dir;
};

/**
 * Runs docker/entrypoint.d/99-werkbuch.sh in a temporary folder instead of /var/www/html (again in $dir, for a second
 * start), with a fake `php` first on the PATH: it writes its arguments to $dir/php.log (one call per line) and the keys
 * it sees to $dir/keys.log, prints $FAKE_ENSURE_ADMIN for `artisan app:ensure-admin` and ends with
 * $FAKE_ENSURE_ADMIN_EXIT there, else with 0. $role is what serversideup exports as SERVERSIDEUP_DEFAULT_COMMAND
 * (`true` for /init, the web service; null: not set). The keys and passwords of the test process never reach it.
 */
$entrypoint = function (array $env, ?string $role = 'true', ?string $dir = null) use ($entrypointDir): Process {
    $dir ??= $entrypointDir();

    $script = RepoFiles::text('docker/entrypoint.d/99-werkbuch.sh');
    expect(substr_count($script, "\ncd /var/www/html\n"))->toBe(1, 'the entrypoint changes to /var/www/html once');
    file_put_contents($dir.'/entrypoint.sh', str_replace("\ncd /var/www/html\n", "\ncd ".escapeshellarg($dir)."\n", $script));
    file_put_contents($dir.'/bin/php', <<<'SH'
        #!/bin/sh
        printf '%s\n' "$*" | tr '\n' ' ' | sed 's/ *$//' >> "$LOG"
        echo >> "$LOG"
        echo "$APP_KEY|$REVERB_APP_KEY|$REVERB_APP_SECRET" >> "$KEYS_LOG"
        if [ "$1 $2" = "artisan app:ensure-admin" ]; then
            printf '%s\n' "$FAKE_ENSURE_ADMIN"
            exit "${FAKE_ENSURE_ADMIN_EXIT:-0}"
        fi
        exit 0
        SH);
    chmod($dir.'/bin/php', 0755);

    $inherited = array_fill_keys(['APP_KEY', 'REVERB_APP_KEY', 'REVERB_APP_SECRET', 'DB_PASSWORD', 'MEILISEARCH_KEY', 'DOCKER_CMD',
        'SERVERSIDEUP_DEFAULT_COMMAND', 'FAKE_ENSURE_ADMIN', 'FAKE_ENSURE_ADMIN_EXIT', 'ATTACHMENTS_MAX_MB'], false);
    $process = new Process(['sh', $dir.'/entrypoint.sh'], $dir, [
        ...$inherited,
        'PATH' => $dir.'/bin:'.getenv('PATH'),
        'LOG' => $dir.'/php.log',
        'KEYS_LOG' => $dir.'/keys.log',
        'DB_PASSWORD' => 'db-secret',
        'MEILISEARCH_KEY' => 'meili-secret',
        'SERVERSIDEUP_DEFAULT_COMMAND' => $role ?? false,
        ...$env,
    ]);
    $process->run();

    return $process;
};

/** The `php artisan` calls of the entrypoint runs in this folder, in order. */
$artisanCalls = function (Process $process): array {
    $log = $process->getWorkingDirectory().'/php.log';

    return is_file($log) ? array_values(array_filter(file($log, FILE_IGNORE_NEW_LINES), fn (string $line) => str_starts_with($line, 'artisan '))) : [];
};

/** The three key files of the data volume in this folder. */
$keyFiles = fn (string $dir): array => [
    'APP_KEY' => $dir.'/storage/app/.app-key',
    'REVERB_APP_KEY' => $dir.'/storage/app/.reverb-app-key',
    'REVERB_APP_SECRET' => $dir.'/storage/app/.reverb-app-secret',
];

/** Lays down the keys the web service made, as a worker finds them in the volume. */
$webKeys = function (string $dir) use ($keyFiles): void {
    mkdir($dir.'/storage/app', 0777, true);
    foreach ($keyFiles($dir) as $name => $file) {
        file_put_contents($file, match ($name) {
            'APP_KEY' => 'base64:'.base64_encode(str_repeat('k', 32)),
            'REVERB_APP_KEY' => str_repeat('a', 20),
            'REVERB_APP_SECRET' => str_repeat('b', 64),
        });
    }
};

it('has a smoke script a shell accepts', function () {
    $process = new Process(['bash', '-n', repo_path('scripts/compose-smoke.sh')]);
    $process->run();

    expect($process->getExitCode())->toBe(0, $process->getErrorOutput())
        ->and(is_executable(repo_path('scripts/compose-smoke.sh')))->toBeTrue('scripts/compose-smoke.sh is not executable');
});

it('is a script a POSIX shell accepts', function () {
    $process = new Process(['sh', '-n', repo_path('docker/entrypoint.d/99-werkbuch.sh')]);
    $process->run();

    expect($process->getExitCode())->toBe(0, $process->getErrorOutput());
});

it('stops before anything else while DB_PASSWORD or MEILISEARCH_KEY is the placeholder', function (string $name) use ($entrypoint) {
    $process = $entrypoint([$name => 'change-me']);
    $dir = $process->getWorkingDirectory();

    expect($process->getExitCode())->toBe(1)
        ->and($process->getErrorOutput())->toContain("werkbuch: {$name} is still the placeholder change-me")
        ->and(is_dir($dir.'/storage'))->toBeFalse('the entrypoint made storage/ before it stopped')
        ->and(is_file($dir.'/php.log'))->toBeFalse('the entrypoint called php before it stopped');
})->with(['DB_PASSWORD', 'MEILISEARCH_KEY']);

it('runs the web start in order', function () use ($entrypoint, $artisanCalls) {
    $process = $entrypoint(['FAKE_ENSURE_ADMIN' => 'Accounts exist already; ADMIN_EMAIL is only used on the first start.']);

    expect($process->getExitCode())->toBe(0, $process->getErrorOutput())
        ->and($artisanCalls($process))->toBe([
            'artisan config:clear --no-interaction',
            'artisan migrate --force --no-interaction',
            'artisan app:ensure-admin --no-interaction',
            'artisan app:search-sync --no-interaction',
            'artisan app:search-import --if-empty --no-interaction',
            'artisan optimize --no-interaction',
            'artisan scramble:cache --no-interaction',
        ])
        ->and($process->getOutput())->toContain('Accounts exist already; ADMIN_EMAIL is only used on the first start.')
        ->and($process->getOutput())->toEndWith("werkbuch: ready\n");
});

it('says how to get the first account when there is none', function () use ($entrypoint) {
    $none = $entrypoint(['FAKE_ENSURE_ADMIN' => 'ADMIN_EMAIL/ADMIN_PASSWORD are not set; no account created. Without any account nobody can sign in.']);
    $some = $entrypoint(['FAKE_ENSURE_ADMIN' => 'Accounts exist already; ADMIN_EMAIL is only used on the first start.']);

    expect($none->getExitCode())->toBe(0, $none->getErrorOutput())
        ->and($none->getOutput())->toContain('ADMIN_EMAIL/ADMIN_PASSWORD are not set; no account created.')
        ->and($none->getOutput())->toContain('werkbuch: no account yet, set ADMIN_EMAIL and ADMIN_PASSWORD and restart')
        ->and($some->getExitCode())->toBe(0, $some->getErrorOutput())
        ->and($some->getOutput())->toContain('Accounts exist already')
        ->and($some->getOutput())->not->toContain('werkbuch: no account yet');
});

it('stops with the exit code of app:ensure-admin, after its words', function () use ($entrypoint, $artisanCalls) {
    $process = $entrypoint(['FAKE_ENSURE_ADMIN' => 'ADMIN_PASSWORD is the placeholder of the compose file.', 'FAKE_ENSURE_ADMIN_EXIT' => '3']);

    expect($process->getExitCode())->toBe(3)
        ->and($process->getOutput())->toContain('ADMIN_PASSWORD is the placeholder of the compose file.')
        ->and($artisanCalls($process))->toBe([
            'artisan config:clear --no-interaction',
            'artisan migrate --force --no-interaction',
            'artisan app:ensure-admin --no-interaction',
        ]);
});

it('starts a worker without migrating', function (?string $role) use ($entrypoint, $entrypointDir, $artisanCalls, $webKeys) {
    $dir = $entrypointDir();
    $webKeys($dir);

    $process = $entrypoint(['DOCKER_CMD' => 'php artisan queue:work --queue=default'], $role, $dir);

    expect($process->getExitCode())->toBe(0, $process->getErrorOutput())
        ->and($artisanCalls($process))->toBe(['artisan config:clear --no-interaction', 'artisan optimize --no-interaction'])
        ->and($process->getOutput())->toEndWith("werkbuch: ready: php artisan queue:work --queue=default\n");
})->with(['serversideup says false' => 'false', 'not set' => null]);

it('generates the keys once and keeps them in the volume', function () use ($entrypoint, $keyFiles) {
    $first = $entrypoint([]);
    $dir = $first->getWorkingDirectory();
    $made = array_map(fn (string $file) => (string) @file_get_contents($file), $keyFiles($dir));
    $second = $entrypoint([], 'true', $dir);

    expect($first->getExitCode())->toBe(0, $first->getErrorOutput())
        ->and($second->getExitCode())->toBe(0, $second->getErrorOutput())
        ->and($made['APP_KEY'])->toMatch('/^base64:[A-Za-z0-9+\/=]{44}$/')
        ->and(strlen((string) base64_decode(substr($made['APP_KEY'], 7), true)))->toBe(32)
        ->and($made['REVERB_APP_KEY'])->toMatch('/^[0-9a-f]{20}$/')
        ->and($made['REVERB_APP_SECRET'])->toMatch('/^[0-9a-f]{64}$/')
        ->and($first->getOutput())->toContain('werkbuch: generated APP_KEY in storage/app/.app-key')
        ->and($second->getOutput())->not->toContain('werkbuch: generated');

    foreach ($keyFiles($dir) as $name => $file) {
        clearstatcache();
        expect((string) file_get_contents($file))->toBe($made[$name], "{$name} changed on the second start")
            ->and(fileperms($file) & 0777)->toBe(0600, "{$file} is readable by others");
    }

    // every php call, config:clear first, saw the keys of the volume
    $seen = array_unique(file($dir.'/keys.log', FILE_IGNORE_NEW_LINES));
    expect($seen)->toBe([implode('|', $made)]);
});

it('leaves no .tmp behind and replaces one a broken start left', function () use ($entrypoint, $entrypointDir) {
    $dir = $entrypointDir();
    mkdir($dir.'/storage/app', 0777, true);
    file_put_contents($dir.'/storage/app/.app-key.tmp', 'base64:hal');
    chmod($dir.'/storage/app/.app-key.tmp', 0644);
    $temporary = fn () => glob($dir.'/storage/app/{,.}*.tmp', GLOB_BRACE) ?: [];
    expect($temporary())->toBe([$dir.'/storage/app/.app-key.tmp']);

    $process = $entrypoint([], 'true', $dir);
    $key = (string) file_get_contents($dir.'/storage/app/.app-key');
    $mode = fileperms($dir.'/storage/app/.app-key') & 0777;
    $left = $temporary();

    expect($process->getExitCode())->toBe(0, $process->getErrorOutput())
        ->and($left)->toBe([])
        ->and($key)->toMatch('/^base64:[A-Za-z0-9+\/=]{44}$/')
        ->and($mode)->toBe(0600);
});

it('takes keys from the environment and writes no file', function () use ($entrypoint, $keyFiles) {
    $keys = ['APP_KEY' => 'base64:'.base64_encode(str_repeat('e', 32)), 'REVERB_APP_KEY' => str_repeat('c', 20), 'REVERB_APP_SECRET' => str_repeat('d', 64)];
    $process = $entrypoint($keys);
    $dir = $process->getWorkingDirectory();

    expect($process->getExitCode())->toBe(0, $process->getErrorOutput())
        ->and(is_dir($dir.'/storage/app/private'))->toBeTrue()
        ->and(array_unique(file($dir.'/keys.log', FILE_IGNORE_NEW_LINES)))->toBe([implode('|', $keys)]);
    foreach ($keyFiles($dir) as $name => $file) {
        expect(is_file($file))->toBeFalse("{$name} came from the environment and still went to {$file}");
    }
});

it('refuses to start a worker without the keys of the web service', function () use ($entrypoint) {
    $process = $entrypoint(['DOCKER_CMD' => 'php artisan queue:work'], 'false');
    $dir = $process->getWorkingDirectory();

    expect($process->getExitCode())->toBe(1)
        ->and($process->getErrorOutput())->toContain('werkbuch: APP_KEY missing in storage/app/.app-key: start the werkbuch service first')
        ->and(is_file($dir.'/php.log'))->toBeFalse('the worker called php without its keys')
        ->and(is_dir($dir.'/storage'))->toBeFalse('the worker made storage/');
});
