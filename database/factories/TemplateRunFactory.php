<?php

namespace Database\Factories;

use App\Models\Template;
use App\Models\TemplateRun;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * A run of a new template by hand (no term), now, that created nothing it still knows of; `failed()` makes it a run that
 * could not create its item.
 *
 * @extends Factory<TemplateRun>
 */
class TemplateRunFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'template_id' => Template::factory(),
            'scheduled_for' => null,
            'ran_at' => now(),
            'status' => TemplateRun::CREATED,
        ];
    }

    /** A run that failed with the sentence. */
    public function failed(string $error): static
    {
        return $this->state(['status' => TemplateRun::FAILED, 'error' => $error]);
    }
}
