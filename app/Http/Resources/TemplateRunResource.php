<?php

namespace App\Http\Resources;

use App\Models\TemplateRun;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A run of a template (`TemplateRun` in resources/js/types.ts, A338): its term (null for a run by hand), when it ran,
 * whether it created its item (`work_item_id`, null once the item is gone) or failed (`error`, in the language of the
 * organisation), and who pressed „Jetzt ausführen“. It asks the database nothing.
 *
 * @mixin TemplateRun
 */
final class TemplateRunResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var TemplateRun $run */
        $run = $this->resource;

        return [
            'id' => $run->id,
            'template_id' => $run->template_id,
            'scheduled_for' => $run->scheduled_for?->toJSON(),
            'ran_at' => $run->ran_at->toJSON(),
            'status' => $run->status,
            'work_item_id' => $run->work_item_id,
            'error' => $run->error,
            'triggered_by' => $run->triggered_by,
        ];
    }
}
