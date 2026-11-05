<?php

namespace App\Jobs;

use App\Actions\Templates\RunScheduledTemplate;
use App\Models\User;
use App\Support\Actor;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * Runs the due term of a template (RunDueTemplates puts it on `default`). Unique per template for five minutes (K15): the
 * sweeper runs every minute, and while this job waits behind others, it queues no second one. Idempotent: the action
 * works the term out afresh under its locks and the run row is unique per term, so a second job or a try after a crash
 * runs nothing twice.
 */
final class RunTemplateJob implements ShouldBeUnique, ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    /** @var list<int> */
    public array $backoff = [60, 300];

    public int $uniqueFor = 300;

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
}
