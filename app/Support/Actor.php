<?php

namespace App\Support;

use App\Models\PersonalAccessToken;
use App\Models\User;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\Request;

/**
 * Who runs an action and through which channel; the first argument of every action and the `actor_id` and `meta` of
 * every event it records.
 */
final readonly class Actor
{
    public const VIA_UI = 'ui';

    public const VIA_API = 'api';

    public const VIA_MCP = 'mcp';

    public const VIA_AUTOMATION = 'automation';

    public const VIA_TEMPLATE = 'template';

    public const VIA_SYSTEM = 'system';

    public function __construct(
        public User $user,
        public string $via,
        public ?string $reason = null,
        public ?PersonalAccessToken $token = null,
    ) {}

    /**
     * The signed-in account: through the API with its bearer token, otherwise from the interface (the session, which
     * Sanctum hands a transient token).
     *
     * @throws AuthenticationException without an account
     */
    public static function fromRequest(Request $r): self
    {
        $user = $r->user();

        if (! $user instanceof User) {
            throw new AuthenticationException;
        }

        $token = $user->currentAccessToken();

        return $token instanceof PersonalAccessToken
            ? new self($user, self::VIA_API, token: $token)
            : new self($user, self::VIA_UI);
    }

    /**
     * An automation, acting as the default bot; the reason names it (e.g. „Automatisierung: Auto-Archiv“).
     */
    public static function automation(string $reason): self
    {
        return new self(User::defaultBot(), self::VIA_AUTOMATION, $reason);
    }

    /**
     * The system acting on behalf of an account (console commands, setup, password reset), with a reason code.
     */
    public static function system(User $u, string $reason): self
    {
        return new self($u, self::VIA_SYSTEM, $reason);
    }

    /**
     * What an event notes about the actor besides the account.
     *
     * @return array{via: string, reason: string|null, token_id?: string}
     */
    public function meta(): array
    {
        $meta = ['via' => $this->via, 'reason' => $this->reason];

        if ($this->token !== null) {
            $meta['token_id'] = $this->token->id;
        }

        return $meta;
    }
}
