<?php

namespace App\Http\Resources;

use App\Models\Automation;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * An automation of a project (`Automation` in resources/js/types.ts, A346): its key, whether it is on and its settings
 * (always an object). A key without a row has no id. It asks the database nothing.
 *
 * @mixin Automation
 */
final class AutomationResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var Automation $automation */
        $automation = $this->resource;

        return [
            'id' => $automation->exists ? $automation->id : null,
            'project_id' => $automation->project_id,
            'key' => $automation->key->value,
            'enabled' => $automation->enabled,
            'settings' => (object) $automation->settings,
        ];
    }
}
