<?php

namespace App\Support;

/**
 * The runner this instance hands out (spec 8.2, 8.3, A520): the four binaries and their SHA-256 sums in
 * `werkbuch.runner_dist` (in the image root's read-only copy from the build stage `runner`, in DDEV what
 * `ddev runner-build` leaves in runner/dist), and the installer with the address of the instance.
 */
final class RunnerDist
{
    /** The systems and architectures the image builds, in the order of the Dockerfile. */
    public const TARGETS = [['darwin', 'arm64'], ['darwin', 'amd64'], ['linux', 'arm64'], ['linux', 'amd64']];

    /** The placeholder of the address in resources/runner/install.sh. */
    public const URL_PLACEHOLDER = '__WERKBUCH_URL__';

    /** The path of the binary of a target (its sum is that path with `.sha256`), `null` for anything else. */
    public static function path(string $os, string $arch): ?string
    {
        if (! in_array([$os, $arch], self::TARGETS, true)) {
            return null;
        }

        return rtrim((string) config('werkbuch.runner_dist'), '/')."/werkbuch-runner-{$os}-{$arch}";
    }

    /** The installer with APP_URL (without a trailing slash) in single quotes for the shell. */
    public static function script(): string
    {
        $url = rtrim((string) config('app.url'), '/');

        return str_replace(
            "'".self::URL_PLACEHOLDER."'",
            "'".str_replace("'", "'\\''", $url)."'",
            (string) file_get_contents(resource_path('runner/install.sh')),
        );
    }
}
