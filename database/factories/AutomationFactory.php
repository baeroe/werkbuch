<?php

namespace Database\Factories;

use App\Domain\Automations\AutomationKey;
use App\Models\Automation;
use App\Models\Project;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * An automation of a new project, off, with the settings its key starts with: `for($project)->key($key)->enabled($settings)`.
 *
 * @extends Factory<Automation>
 */
class AutomationFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'project_id' => Project::factory(),
            'key' => AutomationKey::AutoArchive,
            'enabled' => false,
            'settings' => fn (array $attributes) => self::keyOf($attributes['key'])->defaults(),
        ];
    }

    /** The automation of this key, with its default settings. */
    public function key(AutomationKey|string $key): static
    {
        $key = self::keyOf($key);

        return $this->state(['key' => $key, 'settings' => $key->defaults()]);
    }

    /**
     * Switched on, with these settings over the defaults of its key.
     *
     * @param  array<string, mixed>  $settings
     */
    public function enabled(array $settings = []): static
    {
        return $this->state(fn (array $attributes) => [
            'enabled' => true,
            'settings' => [...self::keyOf($attributes['key'])->defaults(), ...$settings],
        ]);
    }

    private static function keyOf(mixed $key): AutomationKey
    {
        return $key instanceof AutomationKey ? $key : AutomationKey::from(is_string($key) ? $key : '');
    }
}
