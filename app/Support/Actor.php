<?php

namespace App\Support;

use App\Models\PersonalAccessToken;
use App\Models\Template;
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

    /** The form of a socket ID of Pusher and Reverb: `<number>.<number>` (A282). */
    public const SOCKET_PATTERN = '/^\d+\.\d+\z/';

    public function __construct(
        public User $user,
        public string $via,
        public ?string $reason = null,
        public ?PersonalAccessToken $token = null,
        /** The live connection of the tab that acts (header `X-Socket-ID`, only from the interface): it does not hear its own change (A282). */
        public ?string $socket = null,
        /** The person an automation acts for (A342): `meta.on_behalf_of`, so the person is not told of the result of their own move. */
        public ?string $onBehalfOf = null,
        /**
         * Work nobody is told of (A357): the night of Auto-Close and what it sets off (`meta.quiet`). The history shows
         * it, NotificationFacts passes it over.
         */
        public bool $quiet = false,
    ) {}

    /**
     * The signed-in account: through the API with its bearer token, otherwise from the interface (the session, which
     * Sanctum hands a transient token) with the socket of its live connection, when the header has the form of one.
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

        if ($token instanceof PersonalAccessToken) {
            return new self($user, self::VIA_API, token: $token);
        }

        $socket = $r->header('X-Socket-ID');

        return new self($user, self::VIA_UI, socket: is_string($socket) && preg_match(self::SOCKET_PATTERN, $socket) === 1 ? $socket : null);
    }

    /**
     * The account of a tool call over MCP: always a personal access token (A401); `EnsureMcpToken` has refused everything
     * else at the door already, a TransientToken of a session included (K2).
     *
     * @throws AuthenticationException without an account or without a personal access token
     */
    public static function fromMcp(Request $r): self
    {
        $user = $r->user();
        $token = $user instanceof User ? $user->currentAccessToken() : null;

        if (! $user instanceof User || ! $token instanceof PersonalAccessToken) {
            throw new AuthenticationException;
        }

        return new self($user, self::VIA_MCP, token: $token);
    }

    /**
     * The same actor with another reason (work an action does on the side, such as the children of a deleted item).
     */
    public function withReason(string $reason): self
    {
        return new self($this->user, $this->via, $reason, $this->token, $this->socket, $this->onBehalfOf, $this->quiet);
    }

    /**
     * The same actor acting for a person (A342): an automation a move of the person set off (Assignee beim Start, Eltern
     * schließen) acts as the default bot and names the person in `meta.on_behalf_of`.
     */
    public function onBehalfOf(User $person): self
    {
        return new self($this->user, $this->via, $this->reason, $this->token, $this->socket, $person->id, $this->quiet);
    }

    /** The same actor doing work nobody is told of (A357): its events carry `meta.quiet`. */
    public function quietly(): self
    {
        return new self($this->user, $this->via, $this->reason, $this->token, $this->socket, $this->onBehalfOf, true);
    }

    /**
     * An automation, acting as the default bot; the reason names it (e.g. „Automatisierung: Auto-Archiv“).
     */
    public static function automation(string $reason): self
    {
        return new self(User::defaultBot(), self::VIA_AUTOMATION, $reason);
    }

    /**
     * A template creating its item (A30): the default bot through `template`, with the reason `template`. The run itself
     * names the template in the meta of its event (`meta.template`, A352).
     */
    public static function template(Template $template): self
    {
        return new self(User::defaultBot(), self::VIA_TEMPLATE, 'template');
    }

    /**
     * The system acting on behalf of an account (console commands, setup, password reset), with a reason code.
     */
    public static function system(User $u, string $reason): self
    {
        return new self($u, self::VIA_SYSTEM, $reason);
    }

    /**
     * What an event notes about the actor besides the account. The socket is for the live consumer alone: neither the
     * history nor any resource shows it (and webhooks never send it, phase 11). `on_behalf_of` only when an automation
     * acts for a person, `quiet` only for work nobody is told of (A357).
     *
     * @return array{via: string, reason: string|null, token_id?: string, socket?: string, on_behalf_of?: string, quiet?: true}
     */
    public function meta(): array
    {
        $meta = ['via' => $this->via, 'reason' => $this->reason];

        if ($this->token !== null) {
            $meta['token_id'] = $this->token->id;
        }

        if ($this->socket !== null) {
            $meta['socket'] = $this->socket;
        }

        if ($this->onBehalfOf !== null) {
            $meta['on_behalf_of'] = $this->onBehalfOf;
        }

        if ($this->quiet) {
            $meta['quiet'] = true;
        }

        return $meta;
    }
}
