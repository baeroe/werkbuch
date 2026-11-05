<?php

namespace App\Jobs;

use App\Actions\Automations\RunDailyAutomations;
use App\Models\User;
use App\Support\Actor;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Queue\Middleware\WithoutOverlapping;

/**
 * The nightly automations (spec 4.13: Auto-Archiv, Auto-Close), on the queue `bulk`, for the hour the scheduler planned
 * it in (routes/console.php): RunDailyAutomations acts only when that hour is 03:xx in the zone of the organisation, so a
 * job that waits on the queue past its hour still runs its night and no other. One at a time (K19): a second job while
 * one runs is dropped, not released again; a job dropped at another hour loses nothing, the one of 03:00 comes.
 */
final class RunDailyAutomationsJob implements ShouldQueue
{
    use Queueable;

    public function __construct(public CarbonImmutable $hourUtc)
    {
        $this->onQueue('bulk');
    }

    /**
     * @return list<object>
     */
    public function middleware(): array
    {
        return [(new WithoutOverlapping('daily-automations'))->dontRelease()->expireAfter(3600)];
    }

    public function handle(): void
    {
        RunDailyAutomations::run(Actor::system(User::defaultBot(), 'daily_automations'), $this->hourUtc);
    }
}
