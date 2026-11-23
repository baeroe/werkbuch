<?php

namespace App\OpenApi;

use App\Actions\GitHub\LinkRepository;
use App\Actions\GitHub\StartManifest;

/**
 * The hand-written bodies and answers of the GitHub app and the repo of a project (WEBU-24, spec 10.2, 10.3, 11.3):
 * plain JSON Schema (OpenAPI 3.1). Never a private key or a secret (A510). The bodies are open (`x-werkbuch-open`): the
 * actions pass over keys they do not know (K2).
 */
final class GitHubSchemas
{
    private const ULID = PathParameters::ULID;

    /**
     * @param  array<string, array<string, mixed>>  $properties
     * @param  list<string>  $required
     * @return array<string, mixed>
     */
    private static function object(string $description, array $properties, array $required = [], bool $open = false): array
    {
        return array_filter([
            'type' => 'object',
            'description' => $description,
            'x-werkbuch-open' => $open ?: null,
            'properties' => $properties,
            'required' => $required ?: null,
        ], fn (mixed $value) => $value !== null);
    }

    /**
     * @param  array<string, mixed>  $schema
     * @return array<string, mixed>
     */
    private static function data(array $schema): array
    {
        return self::object('', ['data' => $schema], ['data']);
    }

    /** @return array<string, mixed> */
    private static function time(bool $nullable = true): array
    {
        return ['type' => $nullable ? ['string', 'null'] : 'string', 'format' => 'date-time'];
    }

    /**
     * The repo of a project.
     *
     * @return array<string, mixed>
     */
    private static function link(): array
    {
        return self::object('The repo of a project (spec 10.3).', [
            'project_id' => ['type' => 'string', 'pattern' => self::ULID],
            'repository' => self::object('The repo at GitHub.', [
                'id' => ['type' => 'string', 'pattern' => self::ULID],
                'full_name' => ['type' => 'string', 'description' => '`owner/name`.'],
                'private' => ['type' => 'boolean'],
                'default_branch' => ['type' => 'string'],
                'html_url' => ['type' => 'string', 'format' => 'uri'],
                'removed_at' => [...self::time(), 'description' => 'When the installation stopped reaching it; then no run gets a token for it.'],
            ], ['id', 'full_name', 'private', 'default_branch', 'html_url', 'removed_at']),
            'base_branch' => ['type' => 'string', 'description' => 'What agents branch from and werkbuch merges into.'],
            'protected' => ['type' => ['boolean', 'null'], 'description' => 'Whether a ruleset keeps a direct push off the base branch (only a hint); `null`: GitHub did not say.'],
            'protected_checked_at' => self::time(),
            'guard' => ['anyOf' => [self::object('A push of the app to the base branch no merge of werkbuch explains (spec 11.3): every strand of the project pauses until an admin of the project confirms.', [
                'detected_at' => self::time(false),
                'sha' => ['type' => 'string', 'description' => 'The commit of the push.'],
                'branch' => ['type' => 'string'],
                'run_id' => ['type' => ['string', 'null'], 'description' => 'The one code run of the project that ran then, if there was exactly one.'],
                'item_id' => ['type' => ['string', 'null']],
                'bot_id' => ['type' => ['string', 'null']],
            ], ['detected_at', 'sha', 'branch', 'run_id', 'item_id', 'bot_id']), ['type' => 'null']]],
            'updated_at' => self::time(),
        ], ['project_id', 'repository', 'base_branch', 'protected', 'protected_checked_at', 'guard', 'updated_at']);
    }

    /**
     * `GET /github`, `POST /github/sync`.
     *
     * @return array<string, mixed>
     */
    public static function status(): array
    {
        return self::data(self::object('The one GitHub app of the instance (spec 10.2); never its private key or webhook secret.', [
            'app' => ['anyOf' => [self::object('The app from the manifest flow.', [
                'id' => ['type' => 'string', 'pattern' => self::ULID],
                'app_id' => ['type' => 'integer', 'description' => 'The ID of the app at GitHub.'],
                'slug' => ['type' => 'string'],
                'name' => ['type' => 'string'],
                'owner_login' => ['type' => 'string'],
                'owner_type' => ['type' => 'string', 'description' => '`User` or `Organization`.'],
                'html_url' => ['type' => 'string', 'format' => 'uri'],
                'install_url' => ['type' => 'string', 'format' => 'uri', 'description' => 'Where to install it on more repos.'],
                'permissions' => ['type' => 'object', 'additionalProperties' => ['type' => 'string'], 'description' => 'Permission → `read` or `write`.'],
                'events' => ['type' => 'array', 'items' => ['type' => 'string']],
                'created_at' => self::time(),
            ], ['id', 'app_id', 'slug', 'name', 'owner_login', 'owner_type', 'html_url', 'install_url', 'permissions', 'events', 'created_at']), ['type' => 'null']]],
            'installations' => ['type' => 'array', 'items' => self::object('An installation of the app on a GitHub account.', [
                'id' => ['type' => 'string', 'pattern' => self::ULID],
                'installation_id' => ['type' => 'integer'],
                'account_login' => ['type' => 'string'],
                'account_type' => ['type' => 'string'],
                'repository_selection' => ['type' => 'string', 'description' => '`all` or `selected`.'],
                'suspended_at' => self::time(),
                'removed_at' => [...self::time(), 'description' => 'When it was uninstalled at GitHub.'],
            ], ['id', 'installation_id', 'account_login', 'account_type', 'repository_selection', 'suspended_at', 'removed_at'])],
            'repositories' => ['type' => 'array', 'items' => self::object('A repo an installation reaches.', [
                'id' => ['type' => 'string', 'pattern' => self::ULID],
                'installation_id' => ['type' => 'string', 'pattern' => self::ULID],
                'full_name' => ['type' => 'string'],
                'private' => ['type' => 'boolean'],
                'default_branch' => ['type' => 'string'],
                'html_url' => ['type' => 'string', 'format' => 'uri'],
                'removed_at' => self::time(),
                'taken' => ['type' => 'boolean', 'description' => 'Whether a project has it (also one the reader does not see).'],
                'project' => ['anyOf' => [self::object('The project that has it, if the reader sees it.', [
                    'id' => ['type' => 'string', 'pattern' => self::ULID],
                    'identifier' => ['type' => 'string'],
                    'name' => ['type' => 'string'],
                    'base_branch' => ['type' => 'string'],
                    'protected' => ['type' => ['boolean', 'null']],
                    'guarded' => ['type' => 'boolean', 'description' => 'Whether the guard against an unauthorized merge holds the project.'],
                ], ['id', 'identifier', 'name', 'base_branch', 'protected', 'guarded']), ['type' => 'null']]],
            ], ['id', 'installation_id', 'full_name', 'private', 'default_branch', 'html_url', 'removed_at', 'taken', 'project'])],
        ], ['app', 'installations', 'repositories']));
    }

    /**
     * `POST /github/manifest`.
     *
     * @return array<string, mixed>
     */
    public static function manifestBody(): array
    {
        return self::object('Org admins, only from the session; an instance with an app is 409 `github_connected`. Keys: `'.implode('`, `', StartManifest::FIELDS).'`.', [
            'organization' => ['type' => ['string', 'null'], 'description' => 'The login of a GitHub organization to register the app under; left out or `null`: the own account.'],
        ], [], true);
    }

    /**
     * The answer of `POST /github/manifest`.
     *
     * @return array<string, mixed>
     */
    public static function manifest(): array
    {
        return self::data(self::object('What the browser posts to GitHub; the `state` is good for an hour and for this person once.', [
            'url' => ['type' => 'string', 'format' => 'uri', 'description' => 'The form action (with the state).'],
            'manifest' => ['type' => 'object', 'x-werkbuch-open' => true, 'description' => 'The manifest, as JSON in the form field `manifest`.'],
            'state' => ['type' => 'string'],
        ], ['url', 'manifest', 'state']));
    }

    /**
     * The answer of `DELETE /github`.
     *
     * @return array<string, mixed>
     */
    public static function disconnected(): array
    {
        return self::object('GitHub is disconnected.', ['canceled' => ['type' => 'integer', 'minimum' => 0, 'description' => 'How many runs ended as canceled or are being canceled.']], ['canceled']);
    }

    /**
     * `PUT /projects/{project}/repository`.
     *
     * @return array<string, mixed>
     */
    public static function repositoryBody(): array
    {
        return self::object('The admins of the project (`'.implode('`, `', LinkRepository::FIELDS).'`); every error comes in one 422. While the guard holds the project it is 409 `merge_guard_open`.', [
            'repository_id' => ['type' => ['string', 'null'], 'description' => 'A repo the app reaches, by its ULID or `owner/name`; another project having it is 422; `null` takes the repo away.'],
            'base_branch' => ['type' => ['string', 'null'], 'maxLength' => LinkRepository::BRANCH_MAX, 'description' => 'The base branch; left out or `null`: the default branch of the repo.'],
        ], ['repository_id'], true);
    }

    /**
     * The answer with the repo of a project.
     *
     * @return array<string, mixed>
     */
    public static function repositoryAnswer(): array
    {
        return self::data(['anyOf' => [self::link(), ['type' => 'null']]]);
    }
}
