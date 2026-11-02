<?php

use Meilisearch\Client;
use Tests\Support\Meili;

beforeEach(fn () => Meili::use());

it('throws when Meilisearch failed a task of the test indexes, with its error', function () {
    // no field to take the primary key from: Meilisearch takes the task and fails it later
    app(Client::class)->index('testing_users')->addDocuments([['name' => 'Kira']]);

    expect(fn () => Meili::settle())->toThrow(RuntimeException::class, 'index_primary_key_no_candidate_found');

    // a failure counts once: the next settle looks only at newer tasks
    Meili::settle();
});

it('passes over deleting an index that is not there', function () {
    // use() deleted the indexes already: deleting them again fails with index_not_found, which is what it wanted
    Meili::use();
})->throwsNoExceptions();
