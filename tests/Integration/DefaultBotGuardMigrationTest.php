<?php

use Illuminate\Support\Facades\DB;

/*
 * The migration 2026_11_08_000100_guard_one_default_bot, rolled back and run again on the migrations of the test
 * (DatabaseMigrations). The guard is a virtual column (it takes no room and needs no data written) with a unique index:
 * the database itself keeps a second default bot out.
 */

const DEFAULT_BOT_GUARD_MIGRATION = 'database/migrations/2026_11_08_000100_guard_one_default_bot.php';

/** The definition of `users` as MariaDB writes it. */
$createUsers = fn (): string => (string) ((array) DB::selectOne('show create table `users`'))['Create Table'];

it('makes the guard a virtual column with a unique index and takes both away again', function () use ($createUsers) {
    $column = '`default_bot_guard` tinyint(4) GENERATED ALWAYS AS (if(`is_default_bot`,1,NULL)) VIRTUAL';
    $index = 'UNIQUE KEY `users_default_bot_guard_unique` (`default_bot_guard`)';

    expect($createUsers())->toContain($column)->toContain($index);

    $this->artisan('migrate:rollback', ['--path' => DEFAULT_BOT_GUARD_MIGRATION])->assertSuccessful();

    expect(str_contains($createUsers(), 'default_bot_guard'))->toBeFalse();

    $this->artisan('migrate')->assertSuccessful();

    expect($createUsers())->toContain($column)->toContain($index);
});
