<?php

use Tests\Support\RepoFiles;

/** @return list<string> the workflow files below .github/workflows */
$workflowFiles = function (): array {
    $files = glob(repo_path('.github/workflows/*.yml')) ?: [];
    expect($files)->not->toBeEmpty('no workflow file found');

    return array_map(fn (string $file): string => '.github/workflows/'.basename($file), $files);
};

it('pins every action by commit', function () use ($workflowFiles) {
    $seen = 0;

    foreach ($workflowFiles() as $file) {
        foreach (explode("\n", RepoFiles::text($file)) as $number => $line) {
            if (! str_contains($line, 'uses:')) {
                continue;
            }

            $seen++;
            expect(preg_match('/uses:\s*[\w.-]+\/[\w.\/-]+@[0-9a-f]{40}\s+#\s*v?\d+\.\d+\.\d+\s*$/', $line))
                ->toBe(1, $file.':'.($number + 1).' is not pinned by commit with a version comment: '.trim($line));
        }
    }

    expect($seen)->toBeGreaterThan(0, 'no uses: line found');
});

it('keeps the required job named tests', function () {
    $workflow = RepoFiles::yaml('.github/workflows/tests.yml');

    expect($workflow['jobs'])->toHaveKey('tests');
    expect($workflow['jobs']['tests'])->not->toHaveKey('name');
});

it('builds both platforms on every pull request without pushing', function () {
    $text = RepoFiles::text('.github/workflows/tests.yml');
    $workflow = RepoFiles::yaml('.github/workflows/tests.yml');

    expect($workflow['jobs'])->toHaveKey('image');
    $job = $workflow['jobs']['image'];

    $arches = array_column($job['strategy']['matrix']['include'], 'arch');
    expect($arches)->toContain('amd64');
    expect($arches)->toContain('arm64');
    expect(array_column($job['strategy']['matrix']['include'], 'runner'))->toBe(['ubuntu-24.04', 'ubuntu-24.04-arm']);

    foreach ($job['steps'] as $step) {
        expect($step['with']['push'] ?? false)->not->toBeTrue('the job image pushes');
    }

    expect($text)->not->toContain('docker/login-action');
    expect($workflow['permissions']['contents'])->toBe('read');
    expect($workflow['on'])->toHaveKey('pull_request');
});
