<?php

namespace App\Http\Resources;

use App\Models\View;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A view as `View` of resources/js/types.ts, its filter and display as stored (the normal form; a view whose property
 * is gone answers with its condition as it was saved), both always objects.
 *
 * @mixin View
 */
final class ViewResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var View $view */
        $view = $this->resource;

        return [
            'id' => $view->id,
            'name' => $view->name,
            'icon' => $view->icon,
            'filter' => (object) $view->filter,
            'display' => (object) $view->display,
            'created_by' => $view->created_by,
            'created_at' => $view->created_at?->toJSON(),
            'updated_at' => $view->updated_at?->toJSON(),
        ];
    }
}
