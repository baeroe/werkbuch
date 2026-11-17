<?php

use Illuminate\Support\Facades\Process;
use Illuminate\Support\Str;

it('keeps every route binding with cached routes', function () {
    $names = ['project', 'item', 'relation', 'view', 'comment', 'attachment', 'notification', 'page', 'pageVersion', 'template', 'webhook', 'delivery'];
    $cache = sys_get_temp_dir().'/werkbuch-routes-'.Str::random(12).'.php';
    $artisan = fn (array $args) => Process::path(base_path())->env(['APP_ROUTES_CACHE' => $cache])->timeout(120)->run(['php', 'artisan', ...$args]);

    try {
        $cached = $artisan(['route:cache']);
        expect($cached->successful())->toBeTrue('route:cache failed: '.$cached->errorOutput().$cached->output());

        $bound = collect($names)->map(fn (string $name) => "'{$name}' => Route::getBindingCallback('{$name}') !== null")->implode(', ');
        $run = $artisan(['tinker', '--execute', "echo 'ROUTES:'.json_encode(['cached' => app()->routesAreCached(), 'bound' => [{$bound}], 'search' => Route::getRoutes()->getByName('api.search') !== null]);"]);
        $line = collect(explode("\n", $run->output()))->first(fn (string $l) => str_contains($l, 'ROUTES:'));
        $result = json_decode(Str::after((string) $line, 'ROUTES:'), true);

        expect($result)->toBeArray('tinker gave no answer: '.$run->errorOutput().$run->output())
            ->and($result['cached'])->toBeTrue('the app did not read the routes from the cache '.$cache);
        foreach ($names as $name) {
            expect($result['bound'][$name])->toBeTrue("the binding {{$name}} is lost with cached routes: Route::bind belongs into RouteBindingServiceProvider");
        }
        expect($result['search'])->toBeTrue('the route api.search is missing from the cached routes')
            ->and(file_exists(base_path('bootstrap/cache/routes-v7.php')))->toBeFalse('route:cache wrote bootstrap/cache/routes-v7.php instead of APP_ROUTES_CACHE');
    } finally {
        @unlink($cache);
    }
});
