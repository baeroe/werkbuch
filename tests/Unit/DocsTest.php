<?php

use Tests\Support\RepoFiles;

/** The text below `## $heading` of a docs page up to the next heading of level 2: a check of one section, not of the page. */
$section = function (string $path, string $heading): string {
    $found = preg_match('/^## '.preg_quote($heading, '/').'\n(.*?)(?=^## |\z)/ms', RepoFiles::text($path), $match);

    expect($found)->toBe(1, "{$path} has no section ## {$heading}");

    return $match[1];
};

it('has every docs page in English and German', function () {
    expect(docsPages('en'))->not->toBeEmpty()->toEqualCanonicalizing(docsPages('de'));
});

it('has the same heading structure in both languages', function () {
    // heading levels in order, without the comment lines of code blocks
    $levels = fn (string $file): array => array_map('strlen', preg_match_all('/^(#{1,6}) /m', (string) preg_replace('/^```.*?^```/ms', '', (string) file_get_contents($file)), $m) ? $m[1] : []);

    foreach (docsPages('en') as $page) {
        // same levels in the same order, so the same count
        expect($levels(repo_path("docs/de/{$page}.md")))->toBe($levels(repo_path("docs/en/{$page}.md")), $page);
    }
});

it('lists every page but the landing page in the sidebar', function () {
    $config = (string) file_get_contents(repo_path('docs/.vitepress/config.ts'));

    foreach (array_diff(docsPages('en'), ['index']) as $page) {
        expect($config)->toContain("'{$page}'");
    }
});

it('keeps the sidebar of both languages in the same order', function () {
    $config = RepoFiles::text('docs/.vitepress/config.ts');
    // the keys of `const en` and `const de`: the labels of the groups and pages, in the order they are written
    $keys = function (string $language) use ($config): array {
        expect(preg_match('/^const '.$language.': Record<string, string> = \{\n(.*?)^\};/ms', $config, $block))->toBe(1, "config.ts has no labels for {$language}");
        preg_match_all("/^    '?([a-z\/-]+)'?: /m", $block[1], $m);

        return $m[1];
    };
    // the pages of the sidebar, group by group: one list for both languages
    preg_match_all("/pages: \[([^\]]*)\]/", $config, $lists);
    $pages = [];
    foreach ($lists[1] as $list) {
        preg_match_all("/'([a-z\/-]+)'/", $list, $m);
        $pages = [...$pages, ...$m[1]];
    }

    expect($pages)->toEqualCanonicalizing(array_values(array_diff(docsPages('en'), ['index'])))
        ->and($keys('de'))->toBe($keys('en'));

    // a page in the sidebar has a label in each language, and no label names a page the sidebar lacks
    $labels = $keys('en');
    foreach ($pages as $page) {
        expect($labels)->toContain($page);
    }
    expect(count($labels))->toBe(count($pages) + count($lists[1]));
});

it('names no phase in the docs', function () {
    // the plan of the build is history, a reader of the docs needs no phase; the development page tells that history,
    // and the landing page says in its status where the project stands
    foreach (['en', 'de'] as $l) {
        foreach (array_diff(docsPages($l), ['development', 'index']) as $page) {
            $found = preg_match('/phase \d+/i', RepoFiles::text("docs/{$l}/{$page}.md"), $m);

            expect($found)->toBe(0, "docs/{$l}/{$page}.md names ".($m[0] ?? ''));
        }
    }
});

it('sets a theme color for both themes, the colors of the app', function () {
    $config = RepoFiles::text('docs/.vitepress/config.ts');
    $app = RepoFiles::text('resources/views/app.blade.php');

    foreach (['light', 'dark'] as $scheme) {
        $media = "(prefers-color-scheme: {$scheme})";
        expect(preg_match('/<meta name="theme-color" content="(#[0-9A-Fa-f]{6})" media="'.preg_quote($media, '/').'"/', $app, $color))->toBe(1, "the app has no theme color for {$scheme}");
        expect($config)->toContain("['meta', { name: 'theme-color', content: '".strtolower($color[1])."', media: '{$media}' }]");
    }
});

it('keeps specs, plans and history out of the site', fn () => expect((string) file_get_contents(repo_path('docs/.vitepress/config.ts')))->toContain("'history/**'", "'superpowers/**'"));

it('documents the DDEV commands of the development page in both languages', function () {
    foreach (['en', 'de'] as $l) {
        expect((string) file_get_contents(repo_path("docs/{$l}/development.md")))
            ->toContain('ddev start', 'ddev artisan test --coverage --min=100', 'ddev exec pnpm test:coverage', 'ddev exec pnpm build:coverage', 'pnpm --dir e2e test', 'app:ensure-admin', 'app:reset-password', 'app:search-sync', 'app:search-import', 'docker buildx build', 'scripts/compose-smoke.sh');
    }
});

it('embeds the real compose files in the setup', function () {
    foreach (['en', 'de'] as $l) {
        expect(RepoFiles::text("docs/{$l}/setup.md"))
            ->toContain('<<< @/../docker-compose.standalone.yml{yaml}')
            ->toContain('<<< @/../docker-compose.yml{yaml}');
    }
});

it('explains every variable of .env.docker.example in the table of the setup', function () use ($section) {
    // set or commented out: `NAME=` at the start of a line, with or without `# `
    preg_match_all('/^(?:# )?([A-Z][A-Z0-9_]*)=/m', RepoFiles::text('.env.docker.example'), $matches);
    $names = array_unique($matches[1]);

    // the file names more than a handful: an empty match would let every page pass
    expect($names)->toContain('APP_URL', 'ADMIN_PASSWORD', 'MEILISEARCH_KEY', 'TRUSTED_PROXIES', 'MCP_RATE_LIMIT');

    foreach (['en', 'de'] as $l) {
        // the first cell of each row of the table under ## .env
        preg_match_all('/^\| ([^|]+) \|/m', $section("docs/{$l}/setup.md", '.env'), $cells);
        $first = implode(' ', $cells[1]);

        foreach ($names as $name) {
            expect(str_contains($first, "`{$name}`"))->toBeTrue("{$name} has no row in the table of docs/{$l}/setup.md");
        }
    }
});

it('says until the first release how to build the image', function () {
    foreach (['en', 'de'] as $l) {
        $intro = (string) strstr(RepoFiles::text("docs/{$l}/setup.md"), "\n## ", true);

        expect($intro)->toContain('docker buildx build --load -t werkbuch:local .')->toContain('WERKBUCH_IMAGE=werkbuch:local');
    }
});

it('covers the proxies with WebSockets and HSTS, each in its section', function () use ($section) {
    $proxies = [
        'Caddy' => ['header Strict-Transport-Security', 'reverse_proxy 127.0.0.1:7740'],
        'Traefik' => ['traefik.docker.network=proxy', 'headers.stsSeconds=31536000', 'loadbalancer.server.port=8080'],
        'nginx' => ['proxy_set_header Upgrade $http_upgrade', 'proxy_read_timeout 300s', 'add_header Strict-Transport-Security', 'ssl_certificate ', 'return 301 https://'],
        'Nginx Proxy Manager' => ['Websockets Support', 'HSTS Enabled'],
    ];

    foreach (['en', 'de'] as $l) {
        foreach ($proxies as $heading => $needles) {
            $text = $section("docs/{$l}/reverse-proxy.md", $heading);

            foreach ($needles as $needle) {
                expect(str_contains($text, $needle))->toBeTrue("{$needle} is missing under ## {$heading} of docs/{$l}/reverse-proxy.md");
            }
        }
    }
});

it('keeps the app key in the backup', function () {
    foreach (['en', 'de'] as $l) {
        foreach (["docs/{$l}/setup.md", "docs/{$l}/backup.md"] as $page) {
            expect(RepoFiles::text($page))->toContain('.app-key')->toContain('APP_KEY');
        }

        // the backup reads the volume with the keys, and dumps as the user werkbuch (root has no password login)
        expect(RepoFiles::text("docs/{$l}/backup.md"))
            ->toContain('tar czf - -C /var/www/html/storage/app .')
            ->toContain('mariadb-dump -uwerkbuch')
            ->toContain('--single-transaction');
    }
});

it('names every service and the operational switches', function () {
    $services = array_keys(RepoFiles::yaml('docker-compose.yml')['services']);
    expect($services)->toContain('werkbuch', 'queue-index', 'scheduler', 'mariadb');

    foreach (['en', 'de'] as $l) {
        $page = RepoFiles::text("docs/{$l}/operations.md");
        $needles = [...array_map(fn (string $s) => "`{$s}`", $services), '`WEBHOOKS_ALLOW_PRIVATE`', '`TRUSTED_PROXIES`',
            '`API_RATE_LIMIT`', '`API_SESSION_RATE_LIMIT`', '`MCP_RATE_LIMIT`', '`REVERB_APP_MAX_CONNECTIONS`', 'app:search-import', 'config:clear',
            '`PHP_UPLOAD_MAX_FILE_SIZE`', '`PHP_POST_MAX_SIZE`', '`NGINX_CLIENT_MAX_BODY_SIZE`', '`LOG_LEVEL`'];

        foreach ($needles as $needle) {
            expect(str_contains($page, $needle))->toBeTrue("{$needle} is missing in docs/{$l}/operations.md");
        }
    }
});

it('stops the stack before it updates', function () {
    foreach (['en' => '## Notes per version', 'de' => '## Hinweise je Version'] as $l => $notes) {
        expect(RepoFiles::text("docs/{$l}/upgrading.md"))
            ->toContain('docker compose pull && docker compose down && docker compose up -d')
            ->toContain($notes)
            ->toContain('### 0.1.0');
    }
});
