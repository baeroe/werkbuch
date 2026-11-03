<?php

namespace Database\Factories;

use App\Models\Comment;
use App\Models\User;
use App\Models\WorkItem;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * A comment of one paragraph on a new item (factories write no events and no subscribers).
 *
 * @extends Factory<Comment>
 */
class CommentFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $text = 'Kommentar';

        return [
            'work_item_id' => WorkItem::factory(),
            'author_id' => User::factory(),
            'body' => ['type' => 'doc', 'content' => [['type' => 'paragraph', 'content' => [['type' => 'text', 'text' => $text]]]]],
            'body_text' => $text,
        ];
    }
}
