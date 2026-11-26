<?php

/*
 * The coverage gate of the Pest shards (WEBU-46, A781): merges the `--coverage-php` files of every shard and fails
 * below 100 % of the lines of app/, naming each file with the lines no test ran (as `--coverage --min=100` does).
 *
 *   php scripts/pest-coverage.php <folder> <shards>
 *
 * The folder holds one `*.cov` per shard (in any folder below it); fewer or more than <shards> files fail, so a shard
 * that uploaded nothing never lets the rest pass for the whole. Exit code 0 at 100 %, 1 below, 2 for a wrong call.
 */

use SebastianBergmann\CodeCoverage\Node\Directory;
use SebastianBergmann\CodeCoverage\Node\File;
use SebastianBergmann\CodeCoverage\Report\Facade;
use SebastianBergmann\CodeCoverage\Serialization\Merger;

require dirname(__DIR__).'/vendor/autoload.php';

// the merged coverage of eight shards takes more than the 128 MB of a plain PHP
ini_set('memory_limit', '2G');

[$folder, $shards] = [$argv[1] ?? '', (int) ($argv[2] ?? 0)];

if ($folder === '' || ! is_dir($folder) || $shards < 1) {
    fwrite(STDERR, "usage: php scripts/pest-coverage.php <folder> <shards>\n");
    exit(2);
}

$paths = [];
foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($folder, FilesystemIterator::SKIP_DOTS)) as $file) {
    if ($file instanceof SplFileInfo && $file->getExtension() === 'cov') {
        $paths[] = $file->getPathname();
    }
}
sort($paths);

if (count($paths) !== $shards) {
    fwrite(STDERR, sprintf("expected the coverage of %d shards, found %d:\n%s\n", $shards, count($paths), implode("\n", $paths)));
    exit(1);
}

// every shard ran the same commit on the same PHP and PCOV; their git information is not recorded
$merged = (new Merger)->merge($paths, false);

/** @var Directory $report the facade keeps the report to itself */
$report = (fn (): Directory => $this->report)->call(Facade::fromSerializedData($merged));

/** @return list<string> the lines of a file no test ran, as ranges `12..14` */
$missing = function (File $file): array {
    $ranges = [];
    $from = $to = null;

    foreach ($file->lineCoverageData() as $line => $tests) {
        if ($tests !== []) {
            continue;
        }

        if ($to !== null && $line === $to + 1) {
            $to = $line;

            continue;
        }

        if ($from !== null) {
            $ranges[] = $from === $to ? (string) $from : "{$from}..{$to}";
        }

        $from = $to = $line;
    }

    if ($from !== null) {
        $ranges[] = $from === $to ? (string) $from : "{$from}..{$to}";
    }

    return $ranges;
};

foreach ($report->getIterator() as $node) {
    if ($node instanceof File && $node->numberOfExecutedLines() < $node->numberOfExecutableLines()) {
        echo sprintf("%s: %s\n", $node->id(), implode(', ', $missing($node)));
    }
}

$executed = $report->numberOfExecutedLines();
$executable = $report->numberOfExecutableLines();

echo sprintf("%d shards, %d of %d lines (%s)\n", $shards, $executed, $executable, $report->percentageOfExecutedLines()->asString());

if ($executed < $executable) {
    echo sprintf("Code coverage below 100 %%: %d lines no test ran.\n", $executable - $executed);
    exit(1);
}

exit(0);
