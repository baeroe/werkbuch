<?php

use App\Events\EventConsumer;
use App\Models\User;
use App\Support\Actor;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Collection;
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
 * Locations (file:line) of raw database writes: DB::table(...) chains that write, and DB::insert() and friends, also
 * through DB::connection(...). A chain may span lines and carry closures with statements of their own; arguments are
 * matched as balanced parentheses, so a write inside a closure argument does not count, a write at the end of the chain does.
 *
 * @return list<string>
 */
function rawWrites(string $code, string $file = 'code'): array
{
    $args = '(?(DEFINE)(?<args>\((?:[^()]++|(?&args))*\)))';
    $db = 'DB::(?:connection\s*(?&args)\s*->\s*)?';
    $writes = 'insert|insertOrIgnore|insertGetId|update|updateOrInsert|upsert|delete|truncate|increment|decrement';

    return codeMatches($code, $file, [
        '/'.$db.'table\s*(?&args)(?:\s*->\s*\w+\s*(?&args))*?\s*->\s*(?:'.$writes.')\s*\('.$args.'/',
        '/'.$db.'(?:insert|update|delete|statement|unprepared)\s*\('.$args.'/',
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

/**
 * The messages of lang/<locale>.json.
 *
 * @return array<string, string>
 */
function lang(string $locale): array
{
    return json_decode((string) file_get_contents(repo_path("lang/{$locale}.json")), true, flags: JSON_THROW_ON_ERROR);
}

/**
 * The keys of lang/<locale>.json in file order.
 *
 * @return list<string>
 */
function langKeys(string $locale): array
{
    return array_keys(lang($locale));
}

/**
 * The :placeholders of a message, sorted and without repeats.
 *
 * @return list<string>
 */
function placeholders(string $text): array
{
    preg_match_all('/:[a-z_]+/', $text, $matches);
    $list = array_values(array_unique($matches[0]));
    sort($list);

    return $list;
}

/**
 * The translation keys that code names as a literal: t('a.b'), tn('a.b', n), __('a.b'), trans('a.b') and @lang('a.b').
 * A tn() call counts as its two plural keys. Keys built at run time are not found; they have to be kept complete by hand.
 *
 * @return list<string>
 */
function translationKeysIn(string $code): array
{
    preg_match_all('/(?<![\w>:$])(tn|t|__|trans|@lang)\(\s*([\'"])([^\'"`\\\\\n$]+)\2\s*[,)]/', $code, $matches, PREG_SET_ORDER);

    $keys = [];

    foreach ($matches as [, $function, , $key]) {
        array_push($keys, ...($function === 'tn' ? ["{$key}.one", "{$key}.other"] : [$key]));
    }

    return $keys;
}

/**
 * Every translation key the application code names as a literal (PHP, Blade, and the TypeScript of the app without its tests).
 *
 * @return Collection<int, string>
 */
function usedTranslationKeys(): Collection
{
    $keys = [];

    foreach (['app', 'routes', 'resources/views', 'resources/js'] as $dir) {
        if (! is_dir(repo_path($dir))) {
            continue;
        }

        foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator(repo_path($dir), FilesystemIterator::SKIP_DOTS)) as $file) {
            $path = str_replace('\\', '/', $file->getPathname());

            if (! preg_match('/\.(php|ts|tsx)$/', $path) || preg_match('/\.test\.tsx?$/', $path) || str_contains($path, '/resources/js/test/')) {
                continue;
            }

            array_push($keys, ...translationKeysIn((string) file_get_contents($path)));
        }
    }

    return collect($keys)->unique()->sort()->values();
}

/**
 * A plain actor for tests: the account acting in the interface (or through another channel).
 */
function actor(User $user, string $via = Actor::VIA_UI): Actor
{
    return new Actor($user, $via);
}

/**
 * Sets the classes that receive every event (`werkbuch.event_consumers`).
 *
 * @param  class-string<EventConsumer>  ...$classes
 */
function consumers(string ...$classes): void
{
    config(['werkbuch.event_consumers' => $classes]);
}
