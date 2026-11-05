<?php

use App\Jobs\PruneNotificationsJob;
use App\Jobs\PruneUnownedAttachmentsJob;
use App\Jobs\SendDueRemindersJob;
use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// the outbox: events whose dispatch was lost after the commit; the lock expires after 5 minutes (the default 24 hours
// would outlive a crashed run in the cache)
Schedule::command('app:redispatch-events')->everyMinute()->withoutOverlapping(5);

// uploads nobody owns, older than 24 hours (A239); the scheduler only puts the job on the queue, which takes a moment
Schedule::job(new PruneUnownedAttachmentsJob)->hourly()->withoutOverlapping(60);

// mail collections left behind (a lost dispatch, a job that gave up) get their job again (A288); as above, the lock
// expires after 5 minutes
Schedule::command('app:send-notification-mails')->everyMinute()->withoutOverlapping(5);

// the reminders of what is due, at 08:00 in the time zone of each person (A275): the job carries the hour it was
// planned in (K10), each run of schedule:run reads this file afresh; the lock expires after an hour
Schedule::job(new SendDueRemindersJob(now()->utc()->startOfHour()->toImmutable()))->hourly()->withoutOverlapping(60);

// read notifications and sent collections after 90 days, rows only for mail once sent (A276)
Schedule::job(new PruneNotificationsJob)->hourly()->withoutOverlapping(60);

// the schedules of templates: each due template gets its job (unique per template, K15); as above, the lock expires
// after 5 minutes
Schedule::command('app:run-templates')->everyMinute()->withoutOverlapping(5);
