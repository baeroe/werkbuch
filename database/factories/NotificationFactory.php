<?php

namespace Database\Factories;

use App\Domain\Notifications\NotificationKind;
use App\Models\Notification;
use App\Models\User;
use App\Models\WorkItem;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * An unread inbox notification "item changed (title)" of a new account about a new item, without event, actor and mail.
 *
 * @extends Factory<Notification>
 */
class NotificationFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'kind' => NotificationKind::ItemChanged,
            'work_item_id' => WorkItem::factory(),
            'project_id' => fn (array $attributes) => is_string($attributes['work_item_id'] ?? null)
                ? WorkItem::query()->findOrFail($attributes['work_item_id'])->project_id
                : null,
            'data' => ['fields' => ['title']],
            'inbox' => true,
            'dedupe_key' => fn () => 'factory:'.Str::lower((string) Str::ulid()),
        ];
    }

    /** About the given item, in its project. */
    public function forItem(WorkItem $item): static
    {
        return $this->state(fn (array $attributes) => ['work_item_id' => $item->id, 'project_id' => $item->project_id]);
    }

    /**
     * Of the given kind, with the `data` that kind stores (table "Benachrichtigungsarten" of the phase plan 8).
     *
     * @param  array<string, mixed>  $data
     */
    public function kind(NotificationKind $kind, array $data = []): static
    {
        return $this->state(fn (array $attributes) => ['kind' => $kind, 'data' => $data]);
    }

    /** Read now. */
    public function read(): static
    {
        return $this->state(fn (array $attributes) => ['read_at' => now()]);
    }

    /** Only for mail: the inbox does not show it (A271). */
    public function mailOnly(): static
    {
        return $this->state(fn (array $attributes) => ['inbox' => false]);
    }
}
