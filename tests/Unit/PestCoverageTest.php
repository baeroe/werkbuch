<?php

use SebastianBergmann\CodeCoverage\Data\ProcessedCodeCoverageData;
use SebastianBergmann\CodeCoverage\Serialization\Serializer;
use SebastianBergmann\CodeCoverage\Version;
use Symfony\Component\Process\Process;

/*
 * scripts/pest-coverage.php is the gate of the coverage of the Pest shards in the CI (WEBU-46, A781): the shards cover
 * one file between them, and the script has to see both halves and name the line neither ran.
 */

$source = <<<'PHP'
<?php

function probe(int $x): int
{
    if ($x > 0) {
        return 1;
    }

    return 2;
}

PHP;

/**
 * Writes the `--coverage-php` file of a shard that ran the lines `$ran` of Probe.php (the executable lines are 5, 6
 * and 9), in the format PHPUnit writes.
 *
 * @param  list<int>  $ran
 */
$shard = function (string $folder, string $name, array $ran) use ($source): void {
    $base = $folder.'/src';
    is_dir($base) || mkdir($base, 0777, true);
    file_put_contents($base.'/Probe.php', $source);

    $lines = [];
    foreach ([5, 6, 9] as $line) {
        $lines[$line] = in_array($line, $ran, true) ? [$name] : [];
    }

    $data = new ProcessedCodeCoverageData;
    $data->setLineCoverage(['Probe.php' => $lines]);

    file_put_contents($folder.'/'.$name.'/pest.cov', '<?php // phpunit/php-code-coverage serialization format '.Serializer::SERIALIZATION_FORMAT.PHP_EOL
        .'return \unserialize('.var_export(serialize([
            'buildInformation' => [
                'timestamp' => 'now',
                'runtime' => ['name' => 'PHP', 'version' => PHP_VERSION, 'vendorUrl' => 'https://www.php.net/'],
                'phpCodeCoverage' => [
                    'version' => Version::id(),
                    'serializationFormat' => Serializer::SERIALIZATION_FORMAT,
                    'driverInformation' => ['name' => 'PCOV', 'version' => '1.0.12'],
                ],
            ],
            'basePath' => $base,
            'codeCoverage' => $data,
            'testResults' => [$name => ['size' => 'small', 'status' => 'success', 'time' => 0.1]],
        ]), true).');'.PHP_EOL);
};

$folders = new ArrayObject;

$folder = function (array $shards) use ($shard, $folders): string {
    $folder = sys_get_temp_dir().'/pest-coverage-'.bin2hex(random_bytes(6));
    $folders[] = $folder;

    foreach ($shards as $name => $ran) {
        mkdir($folder.'/'.$name, 0777, true);
        $shard($folder, $name, $ran);
    }

    return $folder;
};

$run = function (string $folder, int $shards): Process {
    $process = new Process([PHP_BINARY, repo_path('scripts/pest-coverage.php'), $folder, (string) $shards]);
    $process->run();

    return $process;
};

afterEach(function () use ($folders) {
    foreach ($folders as $folder) {
        (new Process(['rm', '-rf', $folder]))->mustRun();
    }
    $folders->exchangeArray([]);
});

it('passes when the shards cover every line between them', function () use ($folder, $run) {
    $process = $run($folder(['pest-coverage-1' => [5, 6], 'pest-coverage-2' => [5, 9]]), 2);

    expect($process->getExitCode())->toBe(0, $process->getOutput().$process->getErrorOutput())
        ->and($process->getOutput())->toContain('2 shards, 3 of 3 lines (100.00%)');
});

it('fails naming the line no shard ran', function () use ($folder, $run) {
    $process = $run($folder(['pest-coverage-1' => [5, 6], 'pest-coverage-2' => [5]]), 2);

    expect($process->getExitCode())->toBe(1)
        ->and($process->getOutput())->toContain('Probe.php: 9')
        ->and($process->getOutput())->toContain('2 of 3 lines')
        ->and($process->getOutput())->toContain('Code coverage below 100 %: 1 lines no test ran.');
});

it('fails when a shard left no coverage', function () use ($folder, $run) {
    $process = $run($folder(['pest-coverage-1' => [5, 6, 9]]), 2);

    expect($process->getExitCode())->toBe(1)
        ->and($process->getErrorOutput())->toContain('expected the coverage of 2 shards, found 1');
});

it('refuses a call without folder and number of shards', function () use ($run) {
    expect($run('/nonexistent-'.bin2hex(random_bytes(4)), 2)->getExitCode())->toBe(2)
        ->and($run(sys_get_temp_dir(), 0)->getExitCode())->toBe(2);
});
