<?php

namespace Tests\Support;

use Database\Seeders\Demo\TokensSeeder;
use Database\Seeders\DemoSeeder;
use Illuminate\Database\Seeder;

/**
 * The German demo up to and including the tokens: organization, people, bots, catalog, projects, views, favorites.
 * What comes after (items, wiki, templates, inbox, webhooks) is left out.
 */
class DemoBasicsSeeder extends DemoSeeder
{
    /**
     * @return list<class-string<Seeder>>
     */
    protected function seeders(): array
    {
        return self::basics(parent::seeders());
    }

    /**
     * @param  list<class-string<Seeder>>  $seeders
     * @return list<class-string<Seeder>>
     */
    public static function basics(array $seeders): array
    {
        return array_slice($seeders, 0, (int) array_search(TokensSeeder::class, $seeders, true) + 1);
    }
}
