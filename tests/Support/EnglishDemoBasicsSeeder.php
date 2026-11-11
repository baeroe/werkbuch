<?php

namespace Tests\Support;

use Database\Seeders\DemoSeederEn;
use Illuminate\Database\Seeder;

/**
 * The English demo up to and including the tokens, like DemoBasicsSeeder.
 */
class EnglishDemoBasicsSeeder extends DemoSeederEn
{
    /**
     * @return list<class-string<Seeder>>
     */
    protected function seeders(): array
    {
        return DemoBasicsSeeder::basics(parent::seeders());
    }
}
