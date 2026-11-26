<?php

/*
 * Writes tests/.pest/shards.json, by which `pest --shard` balances the test files of the CI (WEBU-46, A780), from the
 * JUnit files of a CI run: the artifacts `pest-times-<shard>` (`gh run download <run> --pattern 'pest-times-*'`).
 *
 *   php scripts/pest-shards.php <junit.xml>...
 *
 * The times are those of the CI runner with PCOV, the measure the shards are balanced for; `pest --update-shards`
 * writes the same file from a local run. A test class the file does not know goes to the shards in turn.
 */

$timings = [];

foreach (array_slice($argv, 1) as $path) {
    $xml = simplexml_load_file($path);

    if ($xml === false) {
        fwrite(STDERR, "not a JUnit file: {$path}\n");
        exit(2);
    }

    // a test suite with a file is a test class (Pest names it P\Tests\...)
    foreach ($xml->xpath('//testsuite[@file]') ?: [] as $suite) {
        $class = preg_replace('/^P\\\\/', '', (string) $suite['name']);
        $timings[$class] = round(((float) $suite['time']) + ($timings[$class] ?? 0.0), 4);
    }
}

if ($timings === []) {
    fwrite(STDERR, "usage: php scripts/pest-shards.php <junit.xml>... (no test class found)\n");
    exit(2);
}

ksort($timings);
$classes = array_keys($timings);
sort($classes);

$target = dirname(__DIR__).'/tests/.pest/shards.json';
is_dir(dirname($target)) || mkdir(dirname($target), 0755, true);
file_put_contents($target, json_encode([
    'timings' => $timings,
    'checksum' => md5(implode("\n", $classes)),
    'updated_at' => date('c'),
], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES)."\n");

echo sprintf("%d test classes, %.0f s in all\n", count($timings), array_sum($timings));
