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

    expect(collect($job['steps'])->first(fn (array $step): bool => str_contains((string) ($step['uses'] ?? ''), 'docker/build-push-action'))['with'])
        ->toMatchArray(['push' => false, 'load' => true]);

    expect($text)->not->toContain('docker/login-action');
    expect($workflow['permissions']['contents'])->toBe('read');
    expect($workflow['on'])->toHaveKey('pull_request');
});

/**
 * Whether a step pushes an image or logs in to push one: a `push` that is not false, `push=true` in the outputs of a
 * build, `docker push`, `--push` or `imagetools create` in a script, or docker/login-action.
 */
$pushes = function (array $step): bool {
    $with = $step['with'] ?? [];
    $run = (string) ($step['run'] ?? '');

    return (array_key_exists('push', $with) && $with['push'] !== false && $with['push'] !== 'false')
        || str_contains((string) ($with['outputs'] ?? '').','.(string) ($with['output'] ?? ''), 'push=true')
        || preg_match('/\bdocker\s+push\b|--push\b|imagetools\s+create\b/', $run) === 1
        || str_contains((string) ($step['uses'] ?? ''), 'docker/login-action');
};

/** @return list<string> "<job>: <step>" of every pushing step whose step or job lacks the condition of a version tag */
$unguardedPushes = function (array $workflow) use ($pushes): array {
    $unguarded = [];

    foreach ($workflow['jobs'] as $name => $job) {
        foreach ($job['steps'] ?? [] as $index => $step) {
            $guarded = in_array("startsWith(github.ref, 'refs/tags/v')", [$step['if'] ?? null, $job['if'] ?? null], true);

            if ($pushes($step) && ! $guarded) {
                $unguarded[] = $name.': '.($step['name'] ?? $step['uses'] ?? $index);
            }
        }
    }

    return $unguarded;
};

it('recognizes every way a step pushes an image', function () use ($pushes) {
    $pushing = [
        ['uses' => 'docker/build-push-action@x', 'with' => ['push' => true]],
        ['uses' => 'docker/build-push-action@x', 'with' => ['push' => '${{ github.event_name != \'pull_request\' }}']],
        ['uses' => 'docker/build-push-action@x', 'with' => ['outputs' => 'type=image,name=baeroe/werkbuch,push=true']],
        ['uses' => 'docker/bake-action@x', 'with' => ['push' => 'true']],
        ['run' => 'docker push baeroe/werkbuch:latest'],
        ['run' => "docker buildx build \\\n  --push ."],
        ['run' => 'docker buildx imagetools create -t baeroe/werkbuch:1 x'],
        ['uses' => 'docker/login-action@x'],
    ];

    foreach ($pushing as $index => $step) {
        expect($pushes($step))->toBeTrue("step {$index} pushes and was not recognized");
    }

    expect($pushes(['uses' => 'docker/build-push-action@x', 'with' => ['push' => false, 'load' => true]]))->toBeFalse()
        ->and($pushes(['run' => 'docker buildx imagetools inspect baeroe/werkbuch:1']))->toBeFalse()
        ->and($pushes(['run' => 'scripts/compose-smoke.sh']))->toBeFalse();
});

it('pushes only in steps or jobs that run for version tags', function () use ($workflowFiles, $pushes, $unguardedPushes) {
    foreach ($workflowFiles() as $file) {
        expect($unguardedPushes(RepoFiles::yaml($file)))->toBe([], "{$file} pushes outside a version tag");
    }

    $docker = RepoFiles::yaml('.github/workflows/docker.yml');
    $pushing = [];
    foreach ($docker['jobs'] as $name => $job) {
        foreach ($job['steps'] as $step) {
            if ($pushes($step)) {
                $pushing[] = $name.': '.($step['name'] ?? explode('@', (string) $step['uses'])[0]);
            }
        }
    }
    expect($pushing)->toBe([
        'build: Docker Hub login',
        'build: Push the image by digest',
        'merge: docker/login-action',
        'merge: Create the manifest',
    ]);

    // the guard sees a job without the condition: the merge job only pushes because its job runs for tags
    $mutated = $docker;
    unset($mutated['jobs']['merge']['if']);
    expect($unguardedPushes($mutated))->toBe(['merge: Create the manifest']);
});

it('passes expressions to scripts through the environment', function () {
    foreach (['.github/workflows/docker.yml', '.github/workflows/dockerhub.yml'] as $file) {
        $runs = 0;

        foreach (RepoFiles::yaml($file)['jobs'] as $name => $job) {
            foreach ($job['steps'] ?? [] as $index => $step) {
                if (isset($step['run'])) {
                    $runs++;
                    expect(str_contains($step['run'], '${{'))->toBeFalse("{$file} {$name} step {$index} puts an expression into its script");
                }
            }
        }

        expect($runs)->toBeGreaterThan(0, "{$file} has no script");
    }
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
    expect($workflow['jobs']['sync']['if'])->toContain("github.event.workflow_run.event == 'push'")
        ->and($workflow['jobs']['sync']['if'])->toContain("(github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main')");
});

/** @return list<string> the Playwright projects of e2e/playwright.config.ts, `setup` left out, in their order */
$playwrightProjects = function (): array {
    preg_match_all("/\\['([\\w-]+)',\\s*\\w+,\\s*'(?:light|dark)'\\]/", RepoFiles::text('e2e/playwright.config.ts'), $matches);
    expect($matches[1])->toHaveCount(4, 'e2e/playwright.config.ts names other than four projects');

    return $matches[1];
};

/** @return array<string, mixed> the first step of a job whose `uses` starts with `$action` and whose `with` holds all of `$with` */
$stepUsing = function (array $job, string $action, array $with = []): array {
    foreach ($job['steps'] as $step) {
        if (str_starts_with((string) ($step['uses'] ?? ''), $action.'@') && array_intersect_assoc($with, $step['with'] ?? []) === $with) {
            return $step;
        }
    }

    throw new RuntimeException("no step uses {$action} with ".json_encode($with));
};

/** @return list<string> the scripts of the `run:` steps of a job */
$runs = fn (array $job): array => array_values(array_map(fn (array $step): string => (string) $step['run'], array_filter($job['steps'], fn (array $step): bool => isset($step['run']))));

it('runs the e2e suite once per Playwright project', function () use ($playwrightProjects, $stepUsing, $runs) {
    $jobs = RepoFiles::yaml('.github/workflows/tests.yml')['jobs'];
    $e2e = $jobs['e2e'];

    expect($e2e['strategy']['matrix']['project'])->toBe($playwrightProjects())
        ->and($e2e['strategy']['fail-fast'])->toBeFalse()
        ->and($e2e['timeout-minutes'])->toBeLessThanOrEqual(60)
        ->and($e2e['needs'])->toBe('e2e-build')
        ->and($e2e['env']['E2E_PROJECT'])->toBe('${{ matrix.project }}');

    // the build of the job e2e-build, never one of its own
    expect($stepUsing($e2e, 'actions/download-artifact', ['name' => 'e2e-build'])['with']['path'])->toBe('public/build');

    $tests = collect($e2e['steps'])->first(fn (array $step): bool => str_contains((string) ($step['run'] ?? ''), 'pnpm --dir e2e test'));
    expect($tests['run'])->toBe('pnpm --dir e2e test --project=setup --project="$E2E_PROJECT"')
        ->and($tests['env']['E2E_MERGE'])->toBe('0')
        ->and($tests['id'])->toBe('tests');

    // a database, a search, a mailbox, a Reverb and workers of its own per project
    expect(array_keys($e2e['services']))->toEqualCanonicalizing(['mariadb', 'mailpit', 'meilisearch']);
    expect(implode("\n", $runs($e2e)))->toContain('php artisan reverb:start')
        ->and(implode("\n", $runs($e2e)))->toContain('php artisan queue:work --queue=webhooks');
});

it('uploads one remapped coverage file per project', function () use ($stepUsing) {
    $e2e = RepoFiles::yaml('.github/workflows/tests.yml')['jobs']['e2e'];

    $remap = collect($e2e['steps'])->first(fn (array $step): bool => str_contains((string) ($step['run'] ?? ''), '--remap-only'));
    expect($remap['run'])->toBe('node scripts/coverage-merge.mjs --remap-only --out "coverage/e2e-$E2E_PROJECT.json"')
        ->and($remap['if'])->toContain('always()');

    $upload = $stepUsing($e2e, 'actions/upload-artifact', ['name' => 'e2e-coverage-${{ matrix.project }}']);
    // the one mapped file, never the raw files of coverage/e2e (hundreds of MB per project)
    expect($upload['with']['path'])->toBe('coverage/e2e-${{ matrix.project }}.json')
        ->and($upload['with']['if-no-files-found'])->toBe('error')
        ->and($upload['if'])->toBe($remap['if']);

    expect($stepUsing($e2e, 'actions/upload-artifact', ['name' => 'e2e-results-${{ matrix.project }}'])['if'])->toBe('failure()');
});

it('merges the coverage of every project by name with the gate', function () use ($playwrightProjects, $stepUsing, $runs) {
    $merge = RepoFiles::yaml('.github/workflows/tests.yml')['jobs']['e2e-coverage'];

    // needs.e2e-build is only readable for a job that needs it
    expect($merge['needs'])->toEqualCanonicalizing(['e2e-build', 'e2e'])
        ->and($merge['if'])->toBe("always() && needs.e2e-build.result == 'success'");

    expect($stepUsing($merge, 'actions/download-artifact', ['name' => 'unit-coverage'])['with']['path'])->toBe('coverage/unit');
    expect($stepUsing($merge, 'actions/download-artifact', ['pattern' => 'e2e-coverage-*'])['with'])
        ->toMatchArray(['path' => 'coverage/e2e', 'merge-multiple' => false]);

    expect($runs($merge))->toContain('pnpm coverage:merge --expect-shards='.implode(',', $playwrightProjects()));

    expect($stepUsing($merge, 'actions/upload-artifact', ['name' => 'frontend-coverage'])['with']['path'])->toBe('coverage/merged');

    // the coverage can reach 100 % while tests failed: the last step fails with the projects
    $last = end($merge['steps']);
    expect($last['if'])->toBe("always() && needs.e2e.result != 'success'")
        ->and($last['run'])->toContain('exit 1');
});

it('builds the coverage build once', function () use ($stepUsing, $runs) {
    $jobs = RepoFiles::yaml('.github/workflows/tests.yml')['jobs'];
    $build = $jobs['e2e-build'];

    expect($runs($build))->toContain('pnpm build:coverage')
        ->and($runs($build))->toContain('pnpm test:coverage');

    expect($stepUsing($build, 'actions/upload-artifact', ['name' => 'e2e-build'])['with'])
        ->toMatchArray(['path' => 'public/build', 'retention-days' => 3, 'if-no-files-found' => 'error']);
    expect($stepUsing($build, 'actions/upload-artifact', ['name' => 'unit-coverage'])['with'])
        ->toMatchArray(['path' => 'coverage/unit/coverage-final.json', 'retention-days' => 3, 'if-no-files-found' => 'error']);

    foreach ($jobs as $name => $job) {
        if ($name !== 'e2e-build') {
            expect(str_contains(implode("\n", $runs($job)), 'build:coverage'))->toBeFalse("{$name} builds the coverage build again");
        }
    }

    // the gate of the required job keeps its Vitest run (K7)
    expect($runs($jobs['tests']))->toContain('pnpm test:coverage');
});

it('names the e2e jobs for what they do and none of them like the required check', function () {
    $jobs = RepoFiles::yaml('.github/workflows/tests.yml')['jobs'];

    expect($jobs['e2e-build']['name'])->toBe('e2e build (coverage build, Vitest)')
        ->and($jobs['e2e']['name'])->toBe('e2e (${{ matrix.project }})')
        ->and($jobs['e2e-coverage']['name'])->toBe('e2e coverage (merge, 100 % lines)');

    foreach ($jobs as $id => $job) {
        if ($id !== 'tests') {
            expect($job['name'] ?? $id)->not->toBe('tests', "{$id} shows up as the required check tests");
        }
    }
});
