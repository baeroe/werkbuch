<?php

namespace Database\Seeders;

use App\Enums\Locale;

/**
 * The demo of DemoSeeder in English: the team Fieldwork with the same people, projects, keys and times, every text in
 * English (A443). For a database of its own; it refuses one that holds the German demo.
 */
class DemoSeederEn extends DemoSeeder
{
    protected const LOCALE = Locale::En;
}
