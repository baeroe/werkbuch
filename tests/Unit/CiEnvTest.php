<?php

// the .env of the CI job e2e (e2e/ci.env) has the same keys as .env.example, so a new setting cannot be forgotten there
it('keeps the keys of e2e/ci.env equal to .env.example', function () {
    $keys = fn (string $file): array => array_keys(Dotenv\Dotenv::parse((string) file_get_contents(repo_path($file))));

    expect($keys('e2e/ci.env'))->not->toBeEmpty()->toEqualCanonicalizing($keys('.env.example'));
});
