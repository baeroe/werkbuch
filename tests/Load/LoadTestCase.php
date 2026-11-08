<?php

namespace Tests\Load;

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;

/**
 * The test case of the load suite (phpunit.load.xml): no RecordContract (the OpenAPI contract is not part of it and would
 * build the document in tearDown, inside the measured process), no RefreshDatabase (the database `load` keeps its 50 000
 * items between runs, LoadWorld::ensure() seeds it when needed), the event consumers off as in Tests\TestCase.
 * A test file that uses DatabaseTransactions (WorkLoadTest: its actions commit into the transaction of the test, so
 * their afterCommit work runs, K11) gets LoadWorld::ensure() before that transaction begins: a migration or a seed inside
 * it would commit it (DDL) and leave the test's changes in the database `load`.
 */
abstract class LoadTestCase extends BaseTestCase
{
    /**
     * The values phpunit.load.xml forces. PHPUnit writes them to $_ENV and putenv, Laravel reads $_SERVER first, where
     * the environment of the process stays: copied over, so the forced value wins. Only a variable the process gets from
     * outside stands in $_SERVER (DDEV sets the rate limits and WEBHOOKS_ALLOW_PRIVATE, the CI job DB_DATABASE); the
     * others are copied as a safeguard.
     */
    private const FORCED = ['APP_ENV', 'DB_CONNECTION', 'DB_DATABASE', 'DB_URL', 'SCOUT_DRIVER', 'SCOUT_PREFIX', 'CACHE_STORE', 'QUEUE_CONNECTION', 'WEBHOOKS_ALLOW_PRIVATE', 'API_RATE_LIMIT', 'API_SESSION_RATE_LIMIT', 'MCP_RATE_LIMIT'];

    public function createApplication(): Application
    {
        foreach (self::FORCED as $name) {
            if (array_key_exists($name, $_ENV)) {
                $_SERVER[$name] = $_ENV[$name];
            }
        }

        $app = parent::createApplication();
        $app['config']->set('werkbuch.event_consumers', []);

        return $app;
    }

    /** @return array<class-string, class-string> */
    protected function setUpTraits()
    {
        if (isset(($this->traitsUsedByTest ?? class_uses_recursive(static::class))[DatabaseTransactions::class])) {
            LoadWorld::ensure();
        }

        return parent::setUpTraits();
    }

    protected function setUp(): void
    {
        parent::setUp();

        $this->withoutVite();
    }
}
