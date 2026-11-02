<?php

namespace App\Search;

use Illuminate\Database\Eloquent\Model;
use InvalidArgumentException;
use Laravel\Scout\Engines\MeilisearchEngine as ScoutMeilisearchEngine;

/**
 * Scout's Meilisearch engine, which can also remove documents by a filter (RemovesWhere). AppServiceProvider sets it
 * as the driver `meilisearch`.
 */
final class MeilisearchEngine extends ScoutMeilisearchEngine implements RemovesWhere
{
    public function removeWhere(Model $model, string $field, string $value): void
    {
        $index = method_exists($model, 'indexableAs')
            ? $model->indexableAs()
            : throw new InvalidArgumentException($model::class.' is not searchable.');

        $this->meilisearch->index($index)
            ->deleteDocuments(['filter' => sprintf('%s = "%s"', $field, addcslashes($value, '"\\'))]);
    }
}
