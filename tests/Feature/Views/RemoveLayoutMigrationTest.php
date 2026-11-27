<?php

use App\Models\View;
use Illuminate\Support\Facades\DB;

$migration = fn () => require database_path('migrations/2026_11_27_000500_remove_layout_from_views.php');

it('takes the layout out of every stored view and leaves the rest (WEBU-68)', function () use ($migration) {
    $view = View::factory()->create();
    $display = $view->display;
    DB::table('views')->where('id', $view->id)->update(['display' => json_encode(['layout' => 'board', ...$display])]);

    $migration()->up();
    expect($view->refresh()->display)->toBe($display);

    $migration()->down();
    expect($view->refresh()->display)->toMatchArray(['layout' => 'list', ...$display]);
});
