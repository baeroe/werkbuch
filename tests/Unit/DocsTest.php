<?php

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

it('keeps specs, plans and history out of the site', fn () => expect((string) file_get_contents(repo_path('docs/.vitepress/config.ts')))->toContain("'history/**'", "'superpowers/**'"));

it('documents the DDEV commands of the development page in both languages', function () {
    foreach (['en', 'de'] as $l) {
        expect((string) file_get_contents(repo_path("docs/{$l}/development.md")))
            ->toContain('ddev start', 'ddev artisan test --coverage --min=100', 'ddev exec pnpm test:coverage', 'ddev exec pnpm build:coverage', 'pnpm --dir e2e test', 'app:ensure-admin', 'app:reset-password');
    }
});
