<?php

namespace Database\Factories;

use App\Models\User;
use App\Models\View;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * A view without conditions in the plain list, created by a new account (factories write no events).
 *
 * @extends Factory<View>
 */
class ViewFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'name' => fake()->words(2, true),
            'icon' => 'layers',
            'filter' => ['version' => 1, 'conditions' => []],
            'display' => [
                'layout' => 'list',
                'group_by' => 'none',
                'sort' => ['field' => 'rank', 'direction' => 'asc'],
                'fields' => ['key', 'title', 'state', 'assignee'],
                'show_sub_items' => true,
            ],
            'created_by' => User::factory(),
        ];
    }
}
