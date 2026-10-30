<?php

use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Route;
use Inertia\Inertia;
use Tests\TestCase;

pest()->extend(TestCase::class)->use(RefreshDatabase::class)->in('Feature');
pest()->extend(TestCase::class)->use(DatabaseMigrations::class)->in('Integration');

/**
 * Absolute path inside the repository. Unit tests run without the app, so they resolve files
 * through this helper and never through base_path().
 */
function repo_path(string $p = ''): string
{
    return dirname(__DIR__).($p === '' ? '' : '/'.ltrim($p, '/'));
}

/**
 * PHP files below a repository directory, recursively, as paths relative to the repository root.
 *
 * @return list<string>
 */
function appFiles(string $dir): array
{
    $root = repo_path($dir);

    if (! is_dir($root)) {
        return [];
    }

    $files = [];

    foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS)) as $file) {
        if ($file instanceof SplFileInfo && $file->isFile() && $file->getExtension() === 'php') {
            $files[] = ltrim(substr($file->getPathname(), strlen(repo_path())), '/');
        }
    }

    sort($files);

    return $files;
}

/**
 * Locations (file:line) of raw database writes: DB::table(...) chains that write, and DB::insert() and friends.
 *
 * @return list<string>
 */
function rawWrites(string $code, string $file = 'code'): array
{
    return codeMatches($code, $file, [
        '/DB::table\([^;]*?->(?:insert|insertOrIgnore|insertGetId|update|updateOrInsert|upsert|delete|truncate|increment|decrement)\(/s',
        '/DB::(?:insert|update|delete|statement|unprepared)\(/',
    ]);
}

/**
 * Locations (file:line) of Eloquent model writes.
 *
 * @return list<string>
 */
function modelWrites(string $code, string $file = 'code'): array
{
    return codeMatches($code, $file, [
        '/->(?:save|update|delete|forceFill|fill|forceDelete|restore|increment|decrement)\(/',
        '/::(?:create|insert|destroy|updateOrCreate|firstOrCreate)\(/',
    ]);
}

/**
 * @param  list<string>  $patterns
 * @return list<string>
 */
function codeMatches(string $code, string $file, array $patterns): array
{
    $lines = [];

    foreach ($patterns as $pattern) {
        preg_match_all($pattern, $code, $matches, PREG_OFFSET_CAPTURE);

        foreach ($matches[0] as [, $offset]) {
            $lines[] = substr_count($code, "\n", 0, $offset) + 1;
        }
    }

    $lines = array_values(array_unique($lines));
    sort($lines);

    return array_map(fn (int $line) => $file.':'.$line, $lines);
}

/**
 * A plain Inertia page behind the web middleware, for tests of what every page shares. Returns its path; tests call it
 * instead of a real page, so later auth rules do not change them.
 */
function inertiaProbe(): string
{
    Route::middleware('web')->get('_t/page', fn () => Inertia::render('Errors/NotFound'));

    return '_t/page';
}
