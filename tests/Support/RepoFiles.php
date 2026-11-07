<?php

namespace Tests\Support;

use Symfony\Component\Yaml\Yaml;

/**
 * Files of the repository as tests read them (Phase 14): plain text, YAML and the `ENV` of the image. A file that is
 * missing fails the test where it is asked for, never later with an empty string.
 */
final class RepoFiles
{
    /** The text of a file below the repository root. */
    public static function text(string $path): string
    {
        $file = repo_path($path);

        expect(is_file($file))->toBeTrue("{$path} is missing");

        return (string) file_get_contents($file);
    }

    /**
     * A YAML file of the repository; tags like `!reference` stay readable.
     *
     * @return array<mixed>
     */
    public static function yaml(string $path): array
    {
        $parsed = Yaml::parse(self::text($path), Yaml::PARSE_CUSTOM_TAGS);

        expect($parsed)->toBeArray("{$path} is no YAML mapping");

        return $parsed;
    }

    /** The value of `NAME=value` in the `ENV` of the stage `app` of the Dockerfile (an empty value is ''). */
    public static function dockerfileEnv(string $name): string
    {
        $env = [];
        $inApp = false;
        $joined = preg_replace('/\\\\\r?\n/', ' ', self::text('Dockerfile'));

        foreach (explode("\n", (string) $joined) as $line) {
            $line = trim($line);

            if (preg_match('/^FROM\s/i', $line) === 1) {
                $inApp = preg_match('/\sAS\s+app$/i', $line) === 1;
            } elseif ($inApp && preg_match('/^ENV\s+(.*)$/i', $line, $match) === 1) {
                foreach (preg_split('/\s+/', trim($match[1])) ?: [] as $pair) {
                    [$key, $value] = array_pad(explode('=', $pair, 2), 2, null);
                    expect($value)->not->toBeNull("ENV {$pair} is no NAME=value");
                    $env[$key] = (string) $value;
                }
            }
        }

        expect($env)->toHaveKey($name, message: "the stage app sets no ENV {$name}");

        return $env[$name];
    }

    /** A size as PHP and nginx read it (`32M`, `512m`, `1G`, `2048`) in bytes. */
    public static function bytes(string $size): int
    {
        expect($size)->toMatch('/^\d+[KkMmGg]?$/', "{$size} is no size");

        $unit = strtoupper(substr($size, -1));
        $factor = ['K' => 1024, 'M' => 1024 ** 2, 'G' => 1024 ** 3][$unit] ?? 1;

        return (int) $size * $factor;
    }
}
