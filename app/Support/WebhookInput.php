<?php

namespace App\Support;

use App\Domain\Filter\InvalidInput;
use App\Domain\Webhooks\Addresses;
use App\Domain\Webhooks\EventPatterns;
use App\Enums\AccountType;
use App\Models\Project;
use App\Models\User;
use App\Models\Webhook;
use GuzzleHttp\Psr7\Uri;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use InvalidArgumentException;

/**
 * The rules of a webhook's input (plan "REST"): a name, an address, a project or none, events, a bot or none and the
 * switch, all six required both when creating and when replacing (A75). Other keys (the `id`, the stamps of an answer
 * sent back, a `secret`: the server makes it) are passed over. Every error comes in one 422.
 *
 * The address is checked for its form only (A368): `http` or `https`, a host, no user or password, and a host in the
 * one form curl and Guzzle read alike (K5): a DNS name of ASCII letters, digits, `-` and `_` without a trailing dot, a
 * strict dotted quad or an IPv6 literal in brackets. A host whose last label is a number (`127.1`, `2130706433`,
 * `0x7f.1`) is no dotted quad, a host with a non-ASCII letter is refused (not converted to punycode), a backslash
 * anywhere is refused. An address literal in a blocked network and `localhost` with the names below it are refused;
 * `webhooks_allow_private` spares only the private networks (A378, `Addresses::isBlocked`), link-local, metadata and the
 * other blocked networks stay refused. A name is never resolved here, the addresses are checked before every attempt.
 */
final class WebhookInput
{
    public const NAME_MAX = 120;

    /** The column `webhooks.url`. */
    public const URL_MAX = 2048;

    /** The keys of a webhook, all required (A75). */
    public const FIELDS = ['name', 'url', 'project_id', 'events', 'bot_id', 'active'];

    /** The values of Laravel's `boolean` rule. */
    private const BOOLEANS = [[true, true], [false, false], [1, true], [0, false], ['1', true], ['0', false]];

    /**
     * Reads the project with a shared lock: called inside the transaction of saving, a deletion of the project waits
     * for it (or the project is being deleted already and is refused).
     *
     * @param  array<array-key, mixed>  $input  `name`, `url`, `project_id`, `events`, `bot_id`, `active`
     * @param  Webhook|null  $current  the webhook replaced: the bot it has stays allowed though it was deactivated
     * @return array{name: string, url: string, project_id: ?string, events: list<string>, bot_id: ?string, active: bool}
     *
     * @throws ValidationException
     */
    public static function validate(array $input, ?Webhook $current): array
    {
        $errors = [];

        foreach (self::FIELDS as $field) {
            if (! array_key_exists($field, $input)) {
                $errors[$field] = __('field.required');
            }
        }

        $name = array_key_exists('name', $input) ? self::name($input['name'], $errors) : null;
        $url = array_key_exists('url', $input) ? self::url($input['url'], $errors) : null;
        $project = array_key_exists('project_id', $input) ? self::project($input['project_id'], $errors) : null;
        $events = array_key_exists('events', $input) ? self::events($input['events'], $errors) : null;
        $bot = array_key_exists('bot_id', $input) ? self::bot($input['bot_id'], $current, $errors) : null;
        $active = array_key_exists('active', $input) ? self::active($input['active'], $errors) : null;

        if ($errors !== [] || $name === null || $url === null || $events === null || $active === null) {
            throw ValidationException::withMessages($errors);
        }

        return ['name' => $name, 'url' => $url, 'project_id' => $project, 'events' => $events, 'bot_id' => $bot, 'active' => $active];
    }

    /**
     * @param  array<string, mixed>  $errors
     */
    private static function name(mixed $name, array &$errors): ?string
    {
        $name = is_string($name) ? Str::trim($name) : $name;

        if ($name === null || $name === '') {
            $errors['name'] = __('field.name.required');
        } elseif (! is_string($name)) {
            $errors['name'] = __('field.name.invalid');
        } elseif (mb_strlen($name) > self::NAME_MAX) {
            $errors['name'] = __('field.name.max', ['max' => self::NAME_MAX]);
        } else {
            return $name;
        }

        return null;
    }

    /**
     * @param  array<string, mixed>  $errors
     */
    private static function url(mixed $url, array &$errors): ?string
    {
        $url = is_string($url) ? Str::trim($url) : $url;

        $error = match (true) {
            $url === null || $url === '' => 'field.url.required',
            ! is_string($url) => 'field.url.invalid',
            default => self::urlError($url),
        };

        if ($error !== null) {
            $errors['url'] = __($error);

            return null;
        }

        /** @var string $url */
        return $url;
    }

    /**
     * The key of what is wrong with an address, `null` for a good one.
     */
    private static function urlError(string $url): ?string
    {
        // blanks, control and format characters (a zero width space), a backslash, and text that is no UTF-8 at all
        if (strlen($url) > self::URL_MAX || str_contains($url, '\\') || preg_match('/[\s\p{Z}\p{Cc}\p{Cf}]/u', $url) !== 0) {
            return 'field.url.invalid';
        }

        try {
            $uri = new Uri($url);
        } catch (InvalidArgumentException) {
            return 'field.url.invalid';
        }

        if (! in_array($uri->getScheme(), ['http', 'https'], true)) {
            return 'field.url.scheme';
        }
        if ($uri->getUserInfo() !== '') {
            return 'field.url.credentials';
        }

        $host = $uri->getHost();
        $ip = self::literal($host);
        if ($ip === null && ! self::isName($host)) {
            return 'field.url.invalid';
        }

        $allowPrivate = (bool) config('werkbuch.webhooks_allow_private');
        $local = $host === 'localhost' || str_ends_with($host, '.localhost');
        if (($local && ! $allowPrivate) || ($ip !== null && Addresses::isBlocked($ip, $allowPrivate))) {
            return 'field.url.private';
        }

        return null;
    }

    /**
     * The address a host names literally: a strict dotted quad or an IPv6 address in brackets; `null` for anything else.
     */
    public static function literal(string $host): ?string
    {
        if (str_starts_with($host, '[') && str_ends_with($host, ']')) {
            $inner = substr($host, 1, -1);

            return str_contains($inner, ':') && Addresses::isIp($inner) ? $inner : null;
        }

        return ! str_contains($host, ':') && Addresses::isIp($host) ? $host : null;
    }

    /**
     * Whether the host (lower case, as Uri gives it) is a DNS name: labels of ASCII letters, digits, `-` and `_`, no
     * empty one, no trailing dot, and a last label that is no number (curl would read the host as an IPv4 address).
     */
    public static function isName(string $host): bool
    {
        if (preg_match('/^[a-z0-9_-]+(\.[a-z0-9_-]+)*\z/', $host) !== 1) {
            return false;
        }
        $labels = explode('.', $host);

        return preg_match('/^(0x[0-9a-f]*|[0-9]+)\z/', end($labels)) !== 1;
    }

    /**
     * Takes the project the input names with a shared lock before the webhook is locked (T3-M1): the order is always
     * project, then webhook, as PurgeProject goes (the project row, then the webhooks through the cascade).
     *
     * @param  array<array-key, mixed>  $input
     */
    public static function lockProject(array $input): void
    {
        self::lockedProject($input['project_id'] ?? null);
    }

    /**
     * @param  array<string, mixed>  $errors
     */
    private static function project(mixed $id, array &$errors): ?string
    {
        if ($id === null) {
            return null;
        }

        $project = self::lockedProject($id);

        if ($project === null) {
            $errors['project_id'] = __('field.project_id.unknown');

            return null;
        }

        return $project->id;
    }

    /**
     * The project of an id in any spelling, read with a shared lock; `null` for anything else or one being deleted.
     */
    private static function lockedProject(mixed $id): ?Project
    {
        $id = Ids::normalize($id);

        return is_string($id) && Str::isUlid($id)
            ? Project::query()->whereNull('deleting_at')->sharedLock()->find($id)
            : null;
    }

    /**
     * The events in their normal form; checked as a list of names first (EventPatterns takes nothing else).
     *
     * @param  array<string, mixed>  $errors
     * @return list<string>|null
     */
    private static function events(mixed $events, array &$errors): ?array
    {
        if ($events === null || $events === []) {
            $errors['events'] = __('field.events.required');

            return null;
        }
        if (! is_array($events) || ! array_is_list($events) || array_filter($events, fn (mixed $event) => ! is_string($event)) !== []) {
            $errors['events'] = __('field.events.invalid');

            return null;
        }

        try {
            return EventPatterns::normalize($events, Webhook::catalog());
        } catch (InvalidInput $invalid) {
            $errors['events'] = __('field.events.unknown', ['name' => substr($invalid->errors['events'], strlen('unknown:'))]);

            return null;
        }
    }

    /**
     * An active bot; the bot the webhook has needs only to be a bot (it was deactivated meanwhile: the webhook then
     * delivers nothing, A364, but its other fields stay changeable).
     *
     * @param  array<string, mixed>  $errors
     */
    private static function bot(mixed $id, ?Webhook $current, array &$errors): ?string
    {
        if ($id === null) {
            return null;
        }

        $id = Ids::normalize($id);
        $bot = is_string($id) && Str::isUlid($id)
            ? User::query()->where('type', AccountType::Bot)->find($id)
            : null;

        if ($bot === null || ($bot->isDisabled() && $bot->id !== $current?->bot_id)) {
            $errors['bot_id'] = __('field.bot_id.invalid');

            return null;
        }

        return $bot->id;
    }

    /**
     * @param  array<string, mixed>  $errors
     */
    private static function active(mixed $active, array &$errors): ?bool
    {
        foreach (self::BOOLEANS as [$value, $bool]) {
            if ($active === $value) {
                return $bool;
            }
        }

        $errors['active'] = __('field.boolean');

        return null;
    }
}
