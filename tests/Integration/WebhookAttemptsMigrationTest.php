<?php

use App\Models\Webhook;
use App\Models\WebhookAttempt;
use App\Models\WebhookDelivery;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/*
 * The migration 2026_11_06_001410 (task 9, T2-M2): the numbers of attempts grow from a tinyint to a small integer. Going
 * back cuts what no longer fits to 255 first, then narrows the columns again (DatabaseMigrations, `--path`).
 */

const ATTEMPTS_MIGRATION = 'database/migrations/2026_11_06_001410_widen_webhook_attempt_counters.php';

$type = fn (string $table, string $column): string => collect(Schema::getColumns($table))->firstWhere('name', $column)['type'];

it('cuts the numbers to 255 on the way back and widens them again', function () use ($type) {
    $delivery = WebhookDelivery::factory()->for(Webhook::factory()->create())->create(['attempts' => 300]);
    $attempt = WebhookAttempt::factory()->for($delivery, 'delivery')->create(['attempt' => 300]);
    $small = WebhookDelivery::factory()->for($delivery->webhook)->create(['attempts' => 7]);

    expect($type('webhook_deliveries', 'attempts'))->toContain('smallint')
        ->and($type('webhook_attempts', 'attempt'))->toContain('smallint');

    $this->artisan('migrate:rollback', ['--path' => ATTEMPTS_MIGRATION])->assertSuccessful();

    expect($type('webhook_deliveries', 'attempts'))->toContain('tinyint')
        ->and($type('webhook_attempts', 'attempt'))->toContain('tinyint')
        ->and(DB::table('webhook_deliveries')->where('id', $delivery->id)->value('attempts'))->toBe(255)
        ->and(DB::table('webhook_attempts')->where('id', $attempt->id)->value('attempt'))->toBe(255)
        ->and(DB::table('webhook_deliveries')->where('id', $small->id)->value('attempts'))->toBe(7);

    $this->artisan('migrate')->assertSuccessful();

    expect($type('webhook_deliveries', 'attempts'))->toContain('smallint')
        ->and($type('webhook_attempts', 'attempt'))->toContain('smallint');
});
