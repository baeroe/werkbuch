<?php

namespace Tests\Support;

use Database\Seeders\DemoSeederEn;
use Illuminate\Database\Seeder;

/**
 * The English demo up to and including the files, like DemoItemsSeeder.
 */
class EnglishDemoItemsSeeder extends DemoSeederEn
{
    /**
     * @return list<class-string<Seeder>>
     */
    protected function seeders(): array
    {
        return DemoItemsSeeder::items(parent::seeders());
    }
}
