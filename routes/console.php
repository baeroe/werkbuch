<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// the outbox: events whose dispatch was lost after the commit
Schedule::command('app:redispatch-events')->everyMinute()->withoutOverlapping();
