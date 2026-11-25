<?php

namespace App\Http\Controllers;

use App\Actions\GitHub\ReceiveGitHubDelivery;
use App\Http\Middleware\VerifyGitHubSignature;
use App\Models\GitHubApp;
use App\Models\User;
use App\Support\Actor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The webhook of the GitHub app (spec 11.4): the app and its signature are checked (VerifyGitHubSignature), the delivery is kept once
 * and worked in the queue; the answer comes at once, 202 `{delivery, duplicate}`. No account: the system acts.
 */
final class GitHubWebhookController extends Controller
{
    public function receive(Request $request): JsonResponse
    {
        $delivery = $request->header('X-GitHub-Delivery');
        /** @var GitHubApp $app */
        $app = $request->attributes->get(VerifyGitHubSignature::APP);
        $new = ReceiveGitHubDelivery::run(Actor::system(User::defaultBot(), 'github'), [
            'app' => $app->id, 'delivery' => $delivery, 'event' => $request->header('X-GitHub-Event'), 'body' => $request->getContent(),
        ]);

        return response()->json(['delivery' => $delivery, 'duplicate' => ! $new], 202);
    }
}
