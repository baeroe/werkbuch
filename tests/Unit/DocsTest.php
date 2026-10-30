<?php

it('has every docs page in English and German', function () {
    $pages = fn (string $l): array => array_map('basename', glob(repo_path("docs/{$l}/*.md")) ?: []);

    expect($pages('en'))->not->toBeEmpty()->toEqualCanonicalizing($pages('de'));
});

it('has the same heading structure in both languages', function () {
    // heading levels in order, without the comment lines of code blocks
    $levels = fn (string $file): array => array_map('strlen', preg_match_all('/^(#{1,6}) /m', (string) preg_replace('/^```.*?^```/ms', '', (string) file_get_contents($file)), $m) ? $m[1] : []);

    foreach (glob(repo_path('docs/en/*.md')) ?: [] as $en) {
        // same levels in the same order, so the same count
        expect($levels(repo_path('docs/de/'.basename($en))))->toBe($levels($en), basename($en));
    }
});

it('lists every page but the landing page in the sidebar', function () {
    $config = (string) file_get_contents(repo_path('docs/.vitepress/config.ts'));

    foreach (array_diff(array_map(fn ($f) => basename($f, '.md'), glob(repo_path('docs/en/*.md')) ?: []), ['index']) as $page) {
        expect($config)->toContain("'{$page}'");
    }
});

it('keeps specs, plans and history out of the site', fn () => expect((string) file_get_contents(repo_path('docs/.vitepress/config.ts')))->toContain("'history/**'", "'superpowers/**'"));

it('documents the DDEV commands of the development page in both languages', function () {
    foreach (['en', 'de'] as $l) {
        expect((string) file_get_contents(repo_path("docs/{$l}/development.md")))
            ->toContain('ddev start', 'ddev artisan test --coverage --min=100', 'ddev exec pnpm test:coverage', 'ddev exec pnpm build:coverage', 'pnpm --dir e2e test', 'app:ensure-admin', 'app:reset-password');
    }
});
