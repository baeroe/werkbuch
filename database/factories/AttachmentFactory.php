<?php

namespace Database\Factories;

use App\Models\Attachment;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * An upload into a text nobody owns yet, without a file (factories write no events); `forItem()` gives it to an item,
 * `stored()` writes its file.
 *
 * @extends Factory<Attachment>
 */
class AttachmentFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'project_id' => Project::factory(),
            'kind' => 'inline',
            'uploaded_by' => User::factory(),
            'filename' => 'bild.png',
            'mime' => 'image/png',
            'size' => 0,
        ];
    }

    /** Owned by the item, in its project: a picture of its text (`inline`) or a file of its file list (`file`). */
    public function forItem(WorkItem $item, string $kind = 'inline'): self
    {
        return $this->state([
            'project_id' => $item->project_id,
            'attachable_type' => $item->getMorphClass(),
            'attachable_id' => $item->id,
            'kind' => $kind,
        ]);
    }

    /** With its file (on the disk `local`, which tests fake): the contents as given, `mime` and `size` from them. */
    public function stored(string $contents, string $mime, string $filename): self
    {
        return $this->state(['filename' => $filename, 'mime' => $mime, 'size' => strlen($contents)])
            ->afterCreating(fn (Attachment $attachment) => $attachment->addMediaFromString($contents)
                ->usingFileName("{$attachment->id}.bin")
                ->toMediaCollection('file'));
    }
}
