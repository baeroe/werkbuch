<?php

namespace Tests;

use Illuminate\Contracts\Http\Kernel;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Http\Kernel as HttpKernel;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Tests\Support\OpenApi\Contract;
use Tests\Support\OpenApi\RecordContract;

abstract class TestCase extends BaseTestCase
{
    /**
     * The event consumers are off from the start of the app, so also while the migrations of a test run and record
     * events (K2); a test switches them on with consumers().
     */
    public function createApplication(): Application
    {
        // DDEV sets WEBHOOKS_ALLOW_PRIVATE=true for the e2e receiver (A373); phpunit.xml forces it off in $_ENV and
        // putenv, but Laravel reads $_SERVER first, where the real environment of the container stays
        // (a test that sets it itself, ConfigTest::setEnv, sets $_ENV too)
        $_SERVER['WEBHOOKS_ALLOW_PRIVATE'] = ($_ENV['WEBHOOKS_ALLOW_PRIVATE'] ?? '') === 'true' ? 'true' : 'false';

        // the same for the limits of the API that DDEV raises for e2e (K9): the tests run with those of phpunit.xml
        $_SERVER['API_RATE_LIMIT'] = $_ENV['API_RATE_LIMIT'] ?? '600';
        $_SERVER['API_SESSION_RATE_LIMIT'] = $_ENV['API_SESSION_RATE_LIMIT'] ?? '3000';

        $app = parent::createApplication();
        $app['config']->set('werkbuch.event_consumers', []);

        return $app;
    }

    protected function setUp(): void
    {
        parent::setUp();

        $this->withoutVite();

        // every answer under /api/v1 is checked against the OpenAPI document after the test (A385, K3)
        Contract::reset();
        $kernel = $this->app->make(Kernel::class);
        assert($kernel instanceof HttpKernel);
        $kernel->prependMiddleware(RecordContract::class);
    }

    protected function tearDown(): void
    {
        try {
            // before the app goes: the first check of a process generates the document
            Contract::assertClean();
        } finally {
            parent::tearDown();
        }
    }
}
