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

/** @return list<array<string, mixed>> the steps of a job, in order */
$steps = fn (array $workflow, string $job): array => $workflow['jobs'][$job]['steps'];

it('pushes images only for version tags, after the smoke', function () {
    $workflow = RepoFiles::yaml('.github/workflows/docker.yml');
    $on = $workflow['on'];

    expect(array_keys($on))->toEqualCanonicalizing(['push', 'workflow_dispatch']);
    expect($on['push'])->toBe(['tags' => ['v*']]);

    $onlyTags = "startsWith(github.ref, 'refs/tags/v')";
    $smoke = null;
    $firstPush = null;

    foreach ($workflow['jobs'] as $name => $job) {
        foreach ($job['steps'] as $index => $step) {
            $pushes = str_contains((string) ($step['uses'] ?? ''), 'docker/login-action')
                || str_contains((string) ($step['with']['outputs'] ?? ''), 'push=true');

            if ($pushes) {
                expect($step['if'] ?? '')->toBe($onlyTags, "{$name} step {$index} pushes without the tag condition");
            }

            if ($name === 'build' && str_contains((string) ($step['run'] ?? ''), 'compose-smoke.sh')) {
                $smoke = $index;
            }

            if ($name === 'build' && $pushes && str_contains((string) ($step['with']['outputs'] ?? ''), 'push=true')) {
                $firstPush ??= $index;
            }
        }
    }

    expect($smoke)->not->toBeNull('the job build has no smoke step');
    expect($firstPush)->not->toBeNull('the job build has no pushing build');
    expect($smoke)->toBeLessThan($firstPush);

    expect($workflow['permissions'])->toBe(['contents' => 'read']);
    expect($workflow['jobs']['release']['permissions'])->toBe(['contents' => 'write']);
    expect($workflow['jobs']['build'])->not->toHaveKey('permissions');
    expect($workflow['jobs']['merge'])->not->toHaveKey('permissions');
    expect($workflow['jobs']['merge']['if'])->toBe($onlyTags);
    expect($workflow['jobs']['release']['if'])->toBe($onlyTags);
    expect($workflow['jobs']['merge']['needs'])->toBe('build');
    expect($workflow['jobs']['release']['needs'])->toBe('merge');
});

it('checks version and notes before anything is built', function () use ($steps) {
    $workflow = RepoFiles::yaml('.github/workflows/docker.yml');
    $runs = array_values(array_filter($steps($workflow, 'build'), fn (array $step): bool => isset($step['run'])));

    expect($runs[0]['run'])->toContain('scripts/release-version.sh "${GITHUB_REF_NAME#v}"');
    expect($runs[1]['run'])->toContain('scripts/release-notes.sh "${GITHUB_REF_NAME#v}" > /dev/null');

    foreach ([0, 1] as $i) {
        expect($runs[$i]['if'])->toBe("startsWith(github.ref, 'refs/tags/v')");
    }

    $uses = array_map(fn (array $step): string => explode('@', (string) ($step['uses'] ?? ''))[0], $steps($workflow, 'build'));
    // checkout, the two checks, buildx: the first build comes after them
    expect(array_search('docker/build-push-action', $uses, true))->toBeGreaterThan(3);
});

it('syncs the description only while the repository exists', function () use ($steps) {
    $workflow = RepoFiles::yaml('.github/workflows/dockerhub.yml');
    $text = RepoFiles::text('.github/workflows/dockerhub.yml');

    expect(array_keys($workflow['on']))->toEqualCanonicalizing(['push', 'workflow_run', 'workflow_dispatch']);
    expect($workflow['on']['workflow_run']['workflows'])->toBe(['Docker image']);
    expect($text)->toContain('https://hub.docker.com/v2/repositories/baeroe/werkbuch/');
    expect($text)->toContain('::notice::');

    $sync = collect($steps($workflow, 'sync'))->first(fn (array $step): bool => str_contains((string) ($step['uses'] ?? ''), 'peter-evans/dockerhub-description'));
    expect($sync['if'])->toBe("steps.hub.outputs.exists == 'true'");
    expect($sync['with']['repository'])->toBe('baeroe/werkbuch');
    expect(strlen($sync['with']['short-description']))->toBeLessThanOrEqual(100);
    expect($workflow['jobs']['sync']['if'])->toContain("github.event.workflow_run.event == 'push'");
});
