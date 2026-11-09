<?php

use Tests\Support\RepoFiles;

/** The text below `## $heading` of a docs page up to the next heading of level 2: a check of one section, not of the page. */
$section = function (string $path, string $heading): string {
    $found = preg_match('/^## '.preg_quote($heading, '/').'\n(.*?)(?=^## |\z)/ms', RepoFiles::text($path), $match);

    expect($found)->toBe(1, "{$path} has no section ## {$heading}");

    return $match[1];
};

/**
 * The anchor VitePress gives a heading (`slugify` of @mdit-vue/shared, VitePress 1.6): decomposed (NFKD) without the
 * combining marks, so `ä` becomes `a` (`ß` stays), control characters gone, every run of spaces and punctuation one `-`,
 * no `-` at either end, `_` before a leading digit, lower case.
 */
$slug = fn (string $text): string => mb_strtolower((string) preg_replace(
    ['/[\x{0300}-\x{036F}]/u', '/[\x{0000}-\x{001F}]/u', '/[\s~`!@#$%^&*()\-_+=[\]{}|\\\;:"\'“”‘’<>,.?\/]+/u', '/-{2,}/', '/^-+|-+$/', '/^(\d)/'],
    ['', '', '-', '-', '', '_$1'],
    (string) Normalizer::normalize($text, Normalizer::FORM_KD),
));

/**
 * The anchors of a docs page (`en/concepts/views`): one per heading outside code blocks, made from its text as
 * markdown-it reads it (code spans and link texts count, their marks do not), a repeated one with `-1`, `-2`, ….
 *
 * @return list<string>
 */
$anchors = function (string $page) use ($slug): array {
    $text = (string) preg_replace('/^```.*?^```/ms', '', RepoFiles::text("docs/{$page}.md"));
    preg_match_all('/^#{1,6} +(.+?) *$/m', $text, $headings);
    $seen = [];
    foreach ($headings[1] as $heading) {
        $plain = (string) preg_replace(['/\[([^\]]*)\]\([^)]*\)/', '/<[^>]+>/', '/[`*]/', '/\\\\(.)/'], ['$1', '', '', '$1'], $heading);
        $base = $slug($plain);
        $id = $base;
        for ($n = 1; in_array($id, $seen, true); $n++) {
            $id = "{$base}-{$n}";
        }
        $seen[] = $id;
    }

    return $seen;
};

/**
 * The docs page (`en/concepts/views`) a link of the page `$from` goes to: relative to it, from the root of the site, or
 * the page itself for `#anchor`; `null` for a link that leaves the docs (`https://…`, `mailto:`, an app path like
 * `/api/docs`).
 */
$docsPage = function (string $from, string $target): ?string {
    if (preg_match('/^[a-z][a-z0-9+.-]*:/i', $target) || (str_starts_with($target, '/') && ! preg_match('#^/(en|de)(/|$)#', $target))) {
        return null;
    }
    $path = (string) preg_replace('/\.(md|html)$/', '', $target);
    $to = match (true) {
        $path === '' => $from,
        str_starts_with($path, '/') => ltrim($path, '/'),
        default => implode('/', array_reduce(explode('/', dirname($from).'/'.$path), function (array $parts, string $part) {
            if ($part === '..') {
                array_pop($parts);
            } elseif ($part !== '.' && $part !== '') {
                $parts[] = $part;
            }

            return $parts;
        }, [])),
    };

    return str_ends_with($to, '/') || ! str_contains($to, '/') ? rtrim($to, '/').'/index' : $to;
};

/** What a docs page says of a phase of the build (`Phase 15`, `phase-3`, `Phasen 1`), `null` for nothing. */
$namesPhase = fn (string $text): ?string => preg_match('/phase[ns]?[ \t-]*\d+/i', $text, $m) ? $m[0] : null;

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

it('lists every page but the landing page in the sidebar, in the same order in both languages', function () {
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

it('makes the anchors of headings the way VitePress does', function () use ($slug) {
    expect($slug('Erwähnte Items verknüpfen'))->toBe('erwahnte-items-verknupfen')
        ->and($slug('Größe und Maße'))->toBe('große-und-maße')
        ->and($slug('data per event'))->toBe('data-per-event')
        ->and($slug('Wiki: Baum, Seiten & Versionen'))->toBe('wiki-baum-seiten-versionen')
        ->and($slug('1.2.3 – what changed?'))->toBe('_1-2-3-–-what-changed')
        ->and($slug('Rich text (Markdown)'))->toBe('rich-text-markdown');
});

it('reads the target of a link as a page of the docs, and only that', function () use ($docsPage) {
    expect($docsPage('en/api', ''))->toBe('en/api')
        ->and($docsPage('en/api', 'concepts/views'))->toBe('en/concepts/views')
        ->and($docsPage('en/concepts/views', '../api.md'))->toBe('en/api')
        ->and($docsPage('en/api', '/de/concepts/rich-text'))->toBe('de/concepts/rich-text')
        ->and($docsPage('en/api', '/en/'))->toBe('en/index')
        ->and($docsPage('en/api', 'https://www.rfc-editor.org/rfc/rfc9457'))->toBeNull()
        ->and($docsPage('en/api', 'mailto:ops@example.com'))->toBeNull()
        ->and($docsPage('en/api', '/api/docs'))->toBeNull()
        ->and($docsPage('en/api', '/mcp'))->toBeNull();
});

it('links to no anchor a page lacks', function () use ($anchors, $docsPage) {
    $known = [];
    $found = 0;
    foreach (['en', 'de'] as $l) {
        foreach (docsPages($l) as $page) {
            $from = "{$l}/{$page}";
            // links outside code: fenced blocks and code spans are text, not links
            $text = (string) preg_replace(['/^```.*?^```/ms', '/`[^`\n]*`/'], '', RepoFiles::text("docs/{$from}.md"));
            preg_match_all('/\]\(([^)\s#]*)#([^)\s]+)\)/', $text, $links, PREG_SET_ORDER);
            foreach ($links as [, $target, $anchor]) {
                $to = $docsPage($from, $target);
                if ($to === null) {
                    continue;
                }
                expect(is_file(repo_path("docs/{$to}.md")))->toBeTrue("docs/{$from}.md links to {$target}#{$anchor}, a page that does not exist");
                $known[$to] ??= $anchors($to);
                expect(in_array(rawurldecode($anchor), $known[$to], true))->toBeTrue("docs/{$from}.md links to {$target}#{$anchor}, an anchor docs/{$to}.md lacks");
                $found++;
            }
        }
    }
    // the docs link to anchors on their own page and on others: a scan that finds none reads the links wrong
    expect($found)->toBeGreaterThan(150);
});

it('reads a phase of the build, but no number on a line of its own', function () use ($namesPhase) {
    expect($namesPhase('since Phase 15'))->toBe('Phase 15')
        ->and($namesPhase('the phase-3 plan'))->toBe('phase-3')
        ->and($namesPhase('in Phasen 1 und 2'))->toBe('Phasen 1')
        ->and($namesPhase('Phase 2 – 3'))->toBe('Phase 2')
        ->and($namesPhase("the next phase\n\n1. Pull the images"))->toBeNull()
        ->and($namesPhase("the last phase\n2. step"))->toBeNull();
});

it('names no phase in the docs', function () use ($namesPhase) {
    // the plan of the build is history, a reader of the docs needs no phase; for now the landing page says in its status
    // where the project stands
    foreach (['en', 'de'] as $l) {
        foreach (array_diff(docsPages($l), ['index']) as $page) {
            $named = $namesPhase(RepoFiles::text("docs/{$l}/{$page}.md"));

            expect($named)->toBeNull("docs/{$l}/{$page}.md names {$named}");
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

/** The screenshots of the docs in one language (docs/public/screenshots/<language>/*.png), by file name. */
$screenshots = fn (string $language): array => array_map('basename', glob(repo_path("docs/public/screenshots/{$language}/*.png")) ?: []);

/** Every screenshot a text names, as `[language, file]`: `/screenshots/en/board.png` in Markdown or in the front matter. */
$namedScreenshots = fn (string $text): array => preg_match_all('#/screenshots/([a-z]{2})/([a-z0-9-]+\.png)#', $text, $m, PREG_SET_ORDER)
    ? array_map(fn (array $match): array => [$match[1], $match[2]], $m)
    : [];

it('has the same screenshots in English and German', function () use ($screenshots) {
    // the API reference is English only (Stoplight has no German): its shot exists in English alone
    $english = array_values(array_filter($screenshots('en'), fn (string $file): bool => ! str_starts_with($file, 'api-docs')));

    expect($screenshots('en'))->toContain(
        'board.png', 'item.png', 'item-dark.png', 'palette.png', 'templates.png', 'webhooks.png', 'my-items.png', 'table.png',
        'timeline.png', 'inbox.png', 'wiki.png', 'views.png', 'settings-workflow.png', 'automations.png', 'api-docs.png',
    )
        ->and($english)->toEqualCanonicalizing($screenshots('de'));
});

it('reads the screenshots a page names', function () use ($namedScreenshots) {
    expect($namedScreenshots("image: /screenshots/en/board.png\n\n![Board](/screenshots/de/item-dark.png) /screenshots/EN/x.png"))
        ->toBe([['en', 'board.png'], ['de', 'item-dark.png']]);
});

it('shows only screenshots that exist, in the language of the page', function () use ($namedScreenshots) {
    foreach (['en', 'de'] as $language) {
        foreach (docsPages($language) as $page) {
            foreach ($namedScreenshots(RepoFiles::text("docs/{$language}/{$page}.md")) as [$shown, $file]) {
                expect($shown)->toBe($language, "{$language}/{$page}.md shows {$shown}/{$file}")
                    ->and(is_file(repo_path("docs/public/screenshots/{$shown}/{$file}")))->toBeTrue("{$language}/{$page}.md shows {$shown}/{$file}, which is missing");
            }
        }
    }
});

it('keeps every screenshot under 400 KB, at 1440 × 900', function () use ($screenshots) {
    $files = [...$screenshots('en'), ...$screenshots('de')];
    expect($files)->not->toBeEmpty();

    foreach (['en', 'de'] as $language) {
        foreach ($screenshots($language) as $file) {
            $path = repo_path("docs/public/screenshots/{$language}/{$file}");
            expect(filesize($path))->toBeLessThan(400 * 1024, "{$language}/{$file}")
                ->and(array_slice((array) getimagesize($path), 0, 2))->toBe([1440, 900], "{$language}/{$file}");
        }
    }
});
