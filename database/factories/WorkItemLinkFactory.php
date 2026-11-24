<?php

namespace Database\Factories;

use App\Models\WorkItem;
use App\Models\WorkItemLink;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * An open, ready PR of a person in `feldwerk/website` that only links its item. No events.
 *
 * @extends Factory<WorkItemLink>
 */
class WorkItemLinkFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $number = fake()->unique()->numberBetween(1, 99_999);

        return [
            'work_item_id' => WorkItem::factory(),
            'kind' => WorkItemLink::PULL_REQUEST,
            'repository_github_id' => 700_000_001,
            'repository' => 'feldwerk/website',
            'number' => $number,
            'title' => 'Change things',
            'url' => "https://github.com/feldwerk/website/pull/{$number}",
            'state' => WorkItemLink::OPEN,
            'draft' => false,
            'head_branch' => "feature-{$number}",
            'base_branch' => 'main',
            'head_sha' => str_repeat('a', 40),
            'closes' => false,
            'author' => 'mara',
        ];
    }
}
