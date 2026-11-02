<?php

namespace Tests;

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;

abstract class TestCase extends BaseTestCase
{
    /**
     * The event consumers are off from the start of the app, so also while the migrations of a test run and record
     * events (K2); a test switches them on with consumers().
     */
    public function createApplication(): Application
    {
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
