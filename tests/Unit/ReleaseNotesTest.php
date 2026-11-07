<?php

use Symfony\Component\Process\Process;

function releaseScript(string $script, string $argument): Process
{
    $process = new Process([dirname(__DIR__, 2).'/scripts/'.$script, $argument]);
    $process->run();

    return $process;
}

function releaseNotes(string $version): Process
{
    return releaseScript('release-notes.sh', $version);
}

/** The version of config/werkbuch.php (Unit suite: no app, so the file is read as text). */
function configVersion(): string
{
    preg_match("/'version' => '([^']+)'/", (string) file_get_contents(dirname(__DIR__, 2).'/config/werkbuch.php'), $match);

    return $match[1] ?? '';
}

it('prints the notes of a version from docs/en/upgrading.md', function () {
    $process = releaseNotes('0.1.0');

    expect($process->getExitCode())->toBe(0, $process->getErrorOutput())
        ->and($process->getOutput())->toStartWith('- First release')
        ->not->toContain('##')
        ->and(trim($process->getOutput()))->toBe(rtrim($process->getOutput(), "\n"));
});

it('uses the notes of the final version for a pre-release tag', function () {
    expect(releaseNotes('0.1.0-rc.1')->getOutput())->toBe(releaseNotes('0.1.0')->getOutput());
});

it('refuses a version without notes, before anything is published', function () {
    $process = releaseNotes('9.9.9');

    expect($process->getExitCode())->toBe(1)
        ->and($process->getErrorOutput())->toContain('docs/en/upgrading.md has no section "### 9.9.9"');
});

it('has only absolute links, which also work in the GitHub release', function () {
    expect(releaseNotes('0.1.0')->getOutput())->not->toContain('](/')
        ->toContain('](https://github.com/baeroe/werkbuch/blob/main/docs/en/setup.md)');
});

it('has the same section in both languages, with absolute links in each', function () {
    foreach (['en', 'de'] as $language) {
        $text = (string) file_get_contents(dirname(__DIR__, 2)."/docs/{$language}/upgrading.md");

        expect($text)->toContain("\n### 0.1.0\n");
        preg_match('/\n### 0\.1\.0\n(.*?)(?=\n##|\z)/s', $text, $section);
        expect($section[1] ?? '')->not->toContain('](/')
            ->toContain("](https://github.com/baeroe/werkbuch/blob/main/docs/{$language}/setup.md)");
    }
});

it('has notes for the version in config/werkbuch.php', function () {
    $version = configVersion();

    expect($version)->not->toBe('')
        ->and(releaseNotes($version)->getExitCode())->toBe(0)
        ->and(file_get_contents(dirname(__DIR__, 2).'/docs/de/upgrading.md'))->toContain('### '.explode('-', $version)[0]);
});

it('refuses a tag that is not the version of config/werkbuch.php', function () {
    $refused = releaseScript('release-version.sh', '9.9.9');

    expect($refused->getExitCode())->toBe(1)
        ->and($refused->getErrorOutput())->toContain('config/werkbuch.php has version '.configVersion().', the tag says 9.9.9');

    $accepted = releaseScript('release-version.sh', configVersion());
    expect($accepted->getExitCode())->toBe(0, $accepted->getErrorOutput());
});
