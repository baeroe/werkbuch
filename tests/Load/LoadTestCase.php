<?php

namespace Tests\Load;

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;

/**
 * The test case of the load suite (phpunit.load.xml): no RecordContract (the OpenAPI contract is not part of it and would
 * build the document in tearDown, inside the measured process), no RefreshDatabase (the database `load` keeps its 50 000
 * items between runs, LoadWorld::ensure() seeds it when needed), the event consumers off as in Tests\TestCase.
 */
abstract class LoadTestCase extends BaseTestCase
{
    /**
     * The values phpunit.load.xml forces. PHPUnit writes them to $_ENV and putenv, Laravel reads $_SERVER first, where
     * the environment of the container stays (DDEV sets DB_DATABASE=db): copied over, so the forced value wins.
     */
    private const FORCED = ['APP_ENV', 'DB_CONNECTION', 'DB_DATABASE', 'DB_URL', 'SCOUT_DRIVER', 'SCOUT_PREFIX', 'CACHE_STORE', 'QUEUE_CONNECTION', 'WEBHOOKS_ALLOW_PRIVATE'];

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

    protected function setUp(): void
    {
        parent::setUp();

        $this->withoutVite();
    }
}
