<?php

namespace App\Jobs;

use App\Actions\Templates\FailScheduledTemplate;
use App\Actions\Templates\RunScheduledTemplate;
use App\Models\User;
use App\Support\Actor;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Throwable;

/**
 * Runs the due term of a template (RunDueTemplates puts it on `default`). Unique per template for fifteen minutes (K15,
 * longer than its pauses of 60 + 300 s, T13-M4): the sweeper runs every minute, and while this job waits behind others
 * or between its tries, it queues no second one. Idempotent: the action
 * works the term out afresh under its locks and the run row is unique per term, so a second job or a try after a crash
 * runs nothing twice. Should every try throw (no refusal of a field, those end as a failed run of their own), failed()
 * books the term as a failed run (FailScheduledTemplate, T8-M2): the template moves on to its next term and lands in
 * `failed_jobs` once, not again every five minutes.
 */
final class RunTemplateJob implements ShouldBeUnique, ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    /** @var list<int> */
    public array $backoff = [60, 300];

    public int $uniqueFor = 900;

    public function __construct(public string $templateId)
    {
        $this->onQueue('default');
    }

    public function uniqueId(): string
    {
        return $this->templateId;
    }

    public function handle(): void
    {
        RunScheduledTemplate::run(Actor::system(User::defaultBot(), 'templates'), $this->templateId);
    }

    /** After the last try: the term counts as failed, lead and author hear of it. */
    public function failed(?Throwable $error): void
    {
        FailScheduledTemplate::run(Actor::system(User::defaultBot(), 'templates'), $this->templateId);
    }
}
