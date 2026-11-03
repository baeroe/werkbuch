<?php

namespace App\Http\Controllers\Api;

use App\Actions\System\GetSystemStatus;
use App\Actions\System\RetryFailedJobs;
use App\Actions\System\SendTestMail;
use App\Http\Controllers\Controller;
use App\Http\Resources\SystemStatusResource;
use App\Support\Actor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The system page (A287, org admins): its status, failed jobs back into their queues (`{retried}`) and the test mail
 * (`{sent_to}`), both without `data`.
 */
final class SystemController extends Controller
{
    /** @return array{data: SystemStatusResource} */
    public function show(Request $request): array
    {
        return ['data' => new SystemStatusResource(GetSystemStatus::run(Actor::fromRequest($request)))];
    }

    public function retry(Request $request): JsonResponse
    {
        return response()->json(['retried' => RetryFailedJobs::run(Actor::fromRequest($request), $request->all())]);
    }

    public function testMail(Request $request): JsonResponse
    {
        return response()->json(['sent_to' => SendTestMail::run(Actor::fromRequest($request))]);
    }
}
