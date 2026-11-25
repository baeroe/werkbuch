<?php

namespace App\GitHub;

/**
 * The manifest of the app of a GitHub account (spec 4, 10.2, 11.3, A680): pushes, PRs, checks, CI logs; webhooks for
 * PRs, pushes and checks (`installation` and `installation_repositories` every app gets without asking; GitHub refuses
 * them in a manifest). The name is `<login> werkbuch` after the GitHub account (GitHub allows 34 characters and names
 * are global: the person can change it at GitHub), private to its owner, the webhook at `/github/webhook` (one address
 * for every app), back to `/github/manifest` after registering and to `/github/setup` after installing or changing the
 * installation.
 */
final class Manifest
{
    /** @var array<string, string> */
    public const PERMISSIONS = ['contents' => 'write', 'pull_requests' => 'write', 'checks' => 'read', 'actions' => 'read', 'statuses' => 'read', 'metadata' => 'read'];

    /** @var list<string> */
    public const EVENTS = ['pull_request', 'push', 'check_suite', 'check_run'];

    /** GitHub's longest name of an app. */
    public const NAME_MAX = 34;

    private const SUFFIX = ' werkbuch';

    /**
     * @return array<string, mixed>
     */
    public static function for(string $owner, string $appUrl): array
    {
        $base = rtrim($appUrl, '/');

        return [
            'name' => self::name($owner),
            'url' => $base,
            'description' => 'werkbuch at '.$base.': runners push for agents, werkbuch merges and reads checks.',
            'hook_attributes' => ['url' => $base.'/github/webhook', 'active' => true],
            'redirect_url' => $base.'/github/manifest',
            'setup_url' => $base.'/github/setup',
            'setup_on_update' => true,
            'public' => false,
            'default_permissions' => self::PERMISSIONS,
            'default_events' => self::EVENTS,
        ];
    }

    /** The name werkbuch gives the app of an account (the person may change it at GitHub before registering). */
    public static function name(string $owner): string
    {
        return trim(mb_substr($owner, 0, self::NAME_MAX - mb_strlen(self::SUFFIX))).self::SUFFIX;
    }

    /** The list of the apps an account registered at GitHub: the person's own (`User`) or an organization's. */
    public static function appsUrl(string $owner, string $type): string
    {
        $web = rtrim((string) config('werkbuch.github.web_url'), '/');

        return $type === 'Organization' ? $web.'/organizations/'.rawurlencode($owner).'/settings/apps' : $web.'/settings/apps';
    }

    /** Where the browser posts the manifest: the person's own account, or a GitHub organization. */
    public static function registerUrl(?string $organization, string $state): string
    {
        $web = rtrim((string) config('werkbuch.github.web_url'), '/');
        $path = $organization === null ? '/settings/apps/new' : '/organizations/'.rawurlencode($organization).'/settings/apps/new';

        return $web.$path.'?state='.rawurlencode($state);
    }

    /**
     * Where the person installs the app on repos after registering it; GitHub sends the `state` back to the setup URL.
     */
    public static function installUrl(string $slug, ?string $state = null): string
    {
        return rtrim((string) config('werkbuch.github.web_url'), '/').'/apps/'.rawurlencode($slug).'/installations/new'
            .($state === null ? '' : '?state='.rawurlencode($state));
    }
}
