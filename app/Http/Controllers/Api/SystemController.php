<?php

namespace App\Http\Controllers\Api;

use App\Actions\System\GetSystemStatus;
use App\Actions\System\RetryFailedJobs;
use App\Actions\System\SendTestMail;
use App\Http\Api\Answer;
use App\Http\Api\Body;
use App\Http\Controllers\Controller;
use App\Http\Resources\SystemStatusResource;
use App\OpenApi\OperationsSchemas;
use App\Support\Actor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The system page (A287, org admins): its status, failed jobs back into their queues (`{retried}`) and the test mail
 * (`{sent_to}`), both without `data`.
 */
final class SystemController extends Controller
{
    /**
     * Read the system status.
     *
     * Version, queues, failed jobs, search, mail and live updates. Organisation admins (people) only.
     *
     * @return array{data: SystemStatusResource}
     */
    public function show(Request $request): array
    {
        return ['data' => new SystemStatusResource(GetSystemStatus::run(Actor::fromRequest($request)))];
    }

    /**
     * Retry failed jobs.
     *
     * Puts failed jobs back into their queues, the named ones or all of them.
     */
    #[Body(OperationsSchemas::class, 'retry')]
    #[Answer(200, OperationsSchemas::class, 'retried', 'How many jobs went back.')]
    public function retry(Request $request): JsonResponse
    {
        return response()->json(['retried' => RetryFailedJobs::run(Actor::fromRequest($request), $request->all())]);
    }

    /**
     * Send a test mail.
     *
     * To the address of the account, sent in this request. At most 6 a minute per account (429 `too_many_requests`); 409 `mail_not_configured` without a mail server, 503 `mail_failed` when it does not take the mail.
     */
    #[Answer(200, OperationsSchemas::class, 'testMailed', 'The address the test mail went to.')]
    public function testMail(Request $request): JsonResponse
    {
        return response()->json(['sent_to' => SendTestMail::run(Actor::fromRequest($request))]);
    }
}
