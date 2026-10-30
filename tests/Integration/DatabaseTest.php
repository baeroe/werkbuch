<?php

use Illuminate\Support\Facades\DB;

it('runs on MariaDB 11.4 with utf8mb4', function () {
    expect((string) DB::scalar('select version()'))->toStartWith('11.4')
        ->and(DB::connection()->getConfig('charset'))->toBe('utf8mb4');
});
