<?php

use Illuminate\Support\Facades\Process;
use Illuminate\Support\Str;

it('keeps every route binding with cached routes', function () {
    $names = ['project', 'item', 'relation', 'view', 'comment', 'attachment', 'notification', 'page', 'pageVersion', 'template', 'webhook', 'delivery'];
    $cache = sys_get_temp_dir().'/werkbuch-routes-'.Str::random(12).'.php';
    $artisan = fn (array $args) => Process::path(base_path())->env(['APP_ROUTES_CACHE' => $cache])->timeout(120)->run(['php', 'artisan', ...$args]);

    try {
        expect($artisan(['route:cache'])->successful())->toBeTrue();

        $bound = collect($names)->map(fn (string $name) => "'{$name}' => Route::getBindingCallback('{$name}') !== null")->implode(', ');
        $run = $artisan(['tinker', '--execute', "echo 'ROUTES:'.json_encode(['cached' => app()->routesAreCached(), 'bound' => [{$bound}], 'search' => Route::getRoutes()->getByName('api.search') !== null]);"]);
        $line = collect(explode("\n", $run->output()))->first(fn (string $l) => str_contains($l, 'ROUTES:'));
        $result = json_decode(Str::after((string) $line, 'ROUTES:'), true);

        expect($result['cached'])->toBeTrue();
        foreach ($names as $name) {
            expect($result['bound'][$name])->toBeTrue();
        }
        expect($result['search'])->toBeTrue();
        expect(file_exists(base_path('bootstrap/cache/routes-v7.php')))->toBeFalse();
    } finally {
        @unlink($cache);
    }
});
