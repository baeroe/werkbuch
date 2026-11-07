<?php

namespace App\Actions\Attachments;

use App\Exceptions\Problem;
use App\Models\PersonalAccessToken;
use App\Support\Actor;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\URL;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * An address an agent posts a file to (spec 6.2, `get-upload-url`): MCP takes no file as an argument. The address is
 * signed and names the personal access token by its ID (never its secret), the project, the kind and the item, all
 * checked here as the upload checks them (`UploadAttachment::target`); AuthenticateUploadUrl signs the token's account
 * in when the file comes. It lives MINUTES minutes and never longer than its token, and may be used again (A403: curl
 * starts over with the same address after a break, the throttle `attachments` of the account bounds it). Only a personal
 * access token with `mcp` and `write` gets one (K2); nothing is recorded, as for an upload nobody owns yet (A238).
 */
final class IssueUploadUrl
{
    use AsAction;

    /** How long an address lives at most. */
    public const MINUTES = 15;

    /**
     * @param  array<array-key, mixed>  $input  `project_id` (ULID, identifier or former identifier), `kind` (`inline` or `file`), with `file` the `work_item_id` (ULID or key)
     * @return array{url: string, method: 'POST', field: 'file', expires_at: string, curl: string}
     *
     * @throws ValidationException
     * @throws Problem 403 `token_required` without a personal access token with `mcp`, 403 without `write`
     */
    public function handle(Actor $actor, array $input): array
    {
        $token = $actor->token;
        if (! $token instanceof PersonalAccessToken || ! $token->can('mcp')) {
            throw Problem::forbidden(__('problem.detail.mcp_token'), 'token_required');
        }
        if (! $token->can('write')) {
            throw Problem::forbidden(__('problem.detail.token_ability', ['ability' => 'write']));
        }

        [$project, $kind, $item] = UploadAttachment::target($actor, $input);

        // whole seconds: the signature carries the timestamp, so the answer names the second the address ends with
        $expires = CarbonImmutable::now()->addMinutes(self::MINUTES)->startOfSecond();
        if ($token->expires_at !== null && $token->expires_at->lessThan($expires)) {
            $expires = CarbonImmutable::instance($token->expires_at)->startOfSecond();
        }

        $url = URL::temporarySignedRoute('mcp.upload', $expires, [
            'token' => $token->getKey(),
            'project_id' => $project->id,
            'kind' => $kind,
            ...$item === null ? [] : ['work_item_id' => $item->id],
        ]);

        return [
            'url' => $url,
            'method' => 'POST',
            'field' => 'file',
            'expires_at' => $expires->toJSON(),
            'curl' => "curl -F 'file=@<path>' '{$url}'",
        ];
    }
}
