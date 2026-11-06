<?php

namespace App\OpenApi;

use App\Access\OrgRole;
use App\Access\ProjectRole;
use App\Actions\Tokens\CreateToken;
use App\Domain\Accounts\Handle;
use App\Enums\Locale;
use App\Rules\ImageDataUrl;
use App\Support\AccountInput;
use App\Support\PasswordRules;

/**
 * The hand-written bodies and answers of the account side of the API (`#[Body]`, `#[Answer]`): the organization, the
 * accounts and bots, invitations, tokens, the password and the second factor. Plain JSON Schema (OpenAPI 3.1). A body
 * is open (`x-werkbuch-open`, K2): no action here refuses unknown keys, they pass over what they do not read. A body that
 * takes the answer back (`PATCH`) names the keys of the answer the action ignores as `readOnly`, so a client can send
 * its own answer back (A75). `AccountsDocsTest` holds the keys against the
 * `FIELDS` of the actions.
 */
final class AccountSchemas
{
    private const ULID = PathParameters::ULID;

    /**
     * The text of an image field: what may be sent (the rule is `ImageDataUrl`).
     *
     * @return array<string, mixed>
     */
    private static function imageField(string $what): array
    {
        return [
            'type' => ['string', 'null'],
            'format' => 'uri',
            'description' => "The {$what}: a data URL (`data:image/png;base64,…`; PNG, JPEG, WebP or GIF, never SVG; at most "
                .(ImageDataUrl::MAX_BYTES / 1024 / 1024).' MB and '.ImageDataUrl::MAX_EDGE.' px per side) replaces it, `null` removes it, '
                .'the address that came back leaves it as it is.',
        ];
    }

    /** @return array<string, mixed> */
    private static function echoed(string $type): array
    {
        return ['type' => $type, 'readOnly' => true, 'description' => 'Part of the answer; sent back, ignored.'];
    }

    /** @return array<string, mixed> */
    private static function ulid(string $description, bool $nullable = false): array
    {
        return ['type' => $nullable ? ['string', 'null'] : 'string', 'pattern' => self::ULID, 'description' => $description];
    }

    /**
     * `PATCH /organization`.
     *
     * @return array<string, mixed>
     */
    public static function organization(): array
    {
        return [
            'type' => 'object',
            'description' => 'Only the keys that are named change; the answer of the organization may come back as it is.',
            'x-werkbuch-open' => true,
            'properties' => [
                'id' => ['type' => 'string', 'readOnly' => true, 'description' => 'Part of the answer; sent back, ignored.'],
                'name' => ['type' => 'string', 'minLength' => 1, 'maxLength' => AccountInput::NAME_MAX],
                'locale' => ['type' => 'string', 'enum' => Locale::values(), 'description' => 'The default language of the organization.'],
                'timezone' => ['type' => 'string', 'description' => 'An IANA time zone (`Europe/Berlin`); the schedules count in it.'],
                'week_start' => ['type' => 'integer', 'enum' => [0, 1], 'description' => 'The first day of the week: 0 Sunday, 1 Monday.'],
                'logo_url' => self::imageField('logo'),
            ],
        ];
    }

    /**
     * `PATCH /users/{user}`.
     *
     * @return array<string, mixed>
     */
    public static function user(): array
    {
        return [
            'type' => 'object',
            'description' => 'Only the keys that are named change; the answer of the account may come back as it is. '
                .'`locale` and `timezone` of the answer are the effective ones: sent back unchanged they stay inherited from the organization.',
            'x-werkbuch-open' => true,
            'properties' => [
                'id' => self::echoed('string'),
                'type' => ['type' => 'string', 'readOnly' => true, 'description' => 'Part of the answer; sent back, ignored.'],
                'org_role' => ['type' => 'string', 'readOnly' => true, 'description' => 'Part of the answer; sent back, ignored (the role is `PUT /users/{user}/role`).'],
                'is_default_bot' => self::echoed('boolean'),
                'disabled_at' => ['type' => ['string', 'null'], 'readOnly' => true, 'description' => 'Part of the answer; sent back, ignored (see deactivate and reactivate).'],
                'name' => ['type' => 'string', 'minLength' => 1, 'maxLength' => AccountInput::NAME_MAX],
                'handle' => ['type' => 'string', 'pattern' => self::handlePattern(), 'description' => 'The @mention name, 3 to 32 characters of `a-z`, `0-9` and `-`; unique.'],
                'email' => [
                    'type' => ['string', 'null'], 'maxLength' => 255,
                    'description' => 'An e-mail address (trimmed, stored in lower case). People only (a bot has none: leave it out or `null`). Only org admins change an address, and a new address only from the session of the web app (a token gets 403 `session_required`).',
                ],
                'locale' => ['type' => 'string', 'enum' => Locale::values()],
                'timezone' => ['type' => 'string', 'description' => 'An IANA time zone (`Europe/Berlin`).'],
                'avatar_url' => self::imageField('avatar'),
                'description' => [
                    'type' => ['string', 'null'], 'maxLength' => AccountInput::DESCRIPTION_MAX,
                    'description' => 'Bots only; a person has none (leave it out).',
                ],
                'owner_id' => self::ulid('Bots only: the active person who answers for the bot. A bot keeps one (`null` is refused), except the default bot, which has none.', true),
            ],
        ];
    }

    /**
     * `PUT /users/{user}/role`.
     *
     * @return array<string, mixed>
     */
    public static function role(): array
    {
        return [
            'type' => 'object',
            'x-werkbuch-open' => true,
            'properties' => ['org_role' => ['type' => 'string', 'enum' => array_column(OrgRole::cases(), 'value'), 'description' => 'The role in the organization.']],
            'required' => ['org_role'],
        ];
    }

    /**
     * `POST /bots`.
     *
     * @return array<string, mixed>
     */
    public static function bot(): array
    {
        return [
            'type' => 'object',
            'x-werkbuch-open' => true,
            'properties' => [
                'name' => ['type' => 'string', 'minLength' => 1, 'maxLength' => AccountInput::NAME_MAX],
                'handle' => ['type' => 'string', 'pattern' => self::handlePattern(), 'description' => 'The @mention name, 3 to 32 characters of `a-z`, `0-9` and `-`; unique.'],
                'description' => ['type' => ['string', 'null'], 'maxLength' => AccountInput::DESCRIPTION_MAX],
                'owner_id' => self::ulid('The active person who answers for the bot; without it the account that creates the bot.', true),
            ],
            'required' => ['name', 'handle'],
        ];
    }

    /**
     * `POST /invitations`.
     *
     * @return array<string, mixed>
     */
    public static function invitation(): array
    {
        return [
            'type' => 'object',
            'x-werkbuch-open' => true,
            'properties' => [
                'email' => ['type' => 'string', 'maxLength' => 255, 'description' => 'An e-mail address (trimmed, stored in lower case) without an account; a new invitation to it replaces the open one, whose link then closes.'],
                'org_role' => ['type' => 'string', 'enum' => array_column(OrgRole::cases(), 'value')],
                'projects' => [
                    'type' => ['array', 'null'],
                    'description' => 'Projects the new account joins, each once, with a role; only projects the inviting admin sees.',
                    'items' => [
                        'type' => 'object',
                        'properties' => [
                            'project_id' => self::ulid('The ULID of the project.'),
                            'role' => ['type' => 'string', 'enum' => array_column(ProjectRole::cases(), 'value')],
                        ],
                        'required' => ['project_id', 'role'],
                    ],
                ],
            ],
            'required' => ['email', 'org_role'],
        ];
    }

    /**
     * `POST /tokens`.
     *
     * @return array<string, mixed>
     */
    public static function token(): array
    {
        return [
            'type' => 'object',
            'x-werkbuch-open' => true,
            'description' => 'Only from the session of the web app: no token mints tokens.',
            'properties' => [
                'user_id' => self::ulid('The owner: the own account, or a bot (org admins); without it the own account.', true),
                'name' => ['type' => 'string', 'minLength' => 1, 'maxLength' => CreateToken::NAME_MAX],
                'abilities' => [
                    'type' => 'array', 'minItems' => 1,
                    'items' => ['type' => 'string', 'enum' => CreateToken::ABILITIES],
                    'description' => '`read` reads, `write` writes, `mcp` may use the MCP endpoint. A repeat is dropped; the token keeps them in this order.',
                ],
                'expires_at' => ['type' => ['string', 'null'], 'format' => 'date-time', 'description' => 'When the token stops working, in the future; `null` for never.'],
            ],
            'required' => ['name', 'abilities'],
        ];
    }

    /**
     * `PUT /me/password`.
     *
     * @return array<string, mixed>
     */
    public static function password(): array
    {
        return [
            'type' => 'object',
            'x-werkbuch-open' => true,
            'properties' => [
                'current_password' => ['type' => 'string', 'description' => 'The password now.'],
                'password' => ['type' => 'string', 'minLength' => PasswordRules::MIN_LENGTH, 'description' => 'The new password; the other sessions of the account end.'],
                'password_confirmation' => ['type' => 'string', 'description' => 'The new password again.'],
            ],
            'required' => ['current_password', 'password', 'password_confirmation'],
        ];
    }

    /**
     * `POST /me/two-factor/confirm`.
     *
     * @return array<string, mixed>
     */
    public static function code(): array
    {
        return [
            'type' => 'object',
            'x-werkbuch-open' => true,
            'properties' => ['code' => ['type' => 'string', 'description' => 'The current code of the authenticator app.']],
            'required' => ['code'],
        ];
    }

    /**
     * `POST /invitations`: 201.
     *
     * @return array<string, mixed>
     */
    public static function invited(): array
    {
        return [
            'type' => 'object',
            'description' => 'No `data` wrapper.',
            'properties' => [
                'link' => ['type' => 'string', 'format' => 'uri', 'description' => 'The link to accept the invitation: what the admin copies when no mail goes out.'],
                'invitation' => ['$ref' => '#/components/schemas/InvitationResource'],
            ],
            'required' => ['link', 'invitation'],
        ];
    }

    /**
     * `POST /tokens`: 201.
     *
     * @return array<string, mixed>
     */
    public static function tokenCreated(): array
    {
        return [
            'type' => 'object',
            'description' => 'No `data` wrapper.',
            'properties' => [
                'token' => ['$ref' => '#/components/schemas/TokenResource'],
                'plain_text' => ['type' => 'string', 'description' => '`<id>|wb_<secret>`: the token itself. It is shown only this once; nothing shows it again.'],
            ],
            'required' => ['token', 'plain_text'],
        ];
    }

    /**
     * `GET /me/two-factor`.
     *
     * @return array<string, mixed>
     */
    public static function twoFactorState(): array
    {
        return [
            'type' => 'object',
            'properties' => [
                'enabled' => ['type' => 'boolean', 'description' => 'Whether signing in asks for a code. A setup that was started but not confirmed is still off.'],
                'confirmed_at' => ['type' => ['string', 'null'], 'format' => 'date-time'],
                'recovery_codes_left' => ['type' => 'integer', 'minimum' => 0],
            ],
            'required' => ['enabled', 'confirmed_at', 'recovery_codes_left'],
        ];
    }

    /**
     * `POST /me/two-factor`.
     *
     * @return array<string, mixed>
     */
    public static function twoFactorSetup(): array
    {
        return [
            'type' => 'object',
            'description' => 'Starts a setup (a new secret each time). The second factor is on once `POST /me/two-factor/confirm` took a code.',
            'properties' => [
                'secret' => ['type' => 'string', 'description' => 'The secret for the authenticator app. It is shown once, with this answer.'],
                'otpauth_url' => ['type' => 'string', 'format' => 'uri', 'description' => 'The `otpauth://` address of the same secret, for apps that open it.'],
                'qr_svg' => ['type' => 'string', 'format' => 'uri', 'description' => 'The QR code of the address as a `data:image/svg+xml;base64,…` URL.'],
            ],
            'required' => ['secret', 'otpauth_url', 'qr_svg'],
        ];
    }

    /**
     * `POST /me/two-factor/confirm` and `POST /me/two-factor/recovery-codes`.
     *
     * @return array<string, mixed>
     */
    public static function recoveryCodes(): array
    {
        return [
            'type' => 'object',
            'properties' => [
                'recovery_codes' => [
                    'type' => 'array', 'items' => ['type' => 'string'],
                    'description' => 'One-time codes for a lost authenticator. They are shown once, with this answer; new ones replace all old ones.',
                ],
            ],
            'required' => ['recovery_codes'],
        ];
    }

    /** The handle pattern as JSON Schema writes it (`\z` is `$`). */
    private static function handlePattern(): string
    {
        return '^'.substr(Handle::PATTERN, 2, -3).'$';
    }
}
