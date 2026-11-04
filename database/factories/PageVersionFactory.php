<?php

namespace Database\Factories;

use App\Models\Page;
use App\Models\PageVersion;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * The kept state of a page as it is stored now: its version, title, content, last author and moment.
 *
 * @extends Factory<PageVersion>
 */
class PageVersionFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'page_id' => Page::factory(),
            'version' => fn (array $attributes) => self::page($attributes)->version,
            'title' => fn (array $attributes) => self::page($attributes)->title,
            'content' => fn (array $attributes) => self::page($attributes)->content,
            'author_id' => fn (array $attributes) => self::page($attributes)->updated_by,
            'created_at' => fn (array $attributes) => self::page($attributes)->updated_at,
        ];
    }

    /**
     * @param  array<string, mixed>  $attributes
     */
    private static function page(array $attributes): Page
    {
        return Page::query()->whereKey($attributes['page_id'])->firstOrFail();
    }
}
