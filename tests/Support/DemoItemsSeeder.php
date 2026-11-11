<?php

namespace Tests\Support;

use Database\Seeders\Demo\AttachmentsSeeder;
use Database\Seeders\Demo\PagesSeeder;
use Database\Seeders\DemoSeeder;
use Illuminate\Database\Seeder;

/**
 * The German demo up to and including the files: what DemoBasicsSeeder seeds, then the items, their history, comments
 * and files. The wiki in between is left out, like everything after the files.
 */
class DemoItemsSeeder extends DemoSeeder
{
    /**
     * @return list<class-string<Seeder>>
     */
    protected function seeders(): array
    {
        return self::items(parent::seeders());
    }

    /**
     * @param  list<class-string<Seeder>>  $seeders
     * @return list<class-string<Seeder>>
     */
    public static function items(array $seeders): array
    {
        $upToFiles = array_slice($seeders, 0, (int) array_search(AttachmentsSeeder::class, $seeders, true) + 1);

        return array_values(array_filter($upToFiles, fn (string $seeder) => $seeder !== PagesSeeder::class));
    }
}
