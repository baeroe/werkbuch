<?php

namespace App\Search;

use Illuminate\Database\Eloquent\Model;

/**
 * An engine that removes documents by the value of a field: the documents of the items of a deleted project, also
 * when their rows are gone already.
 */
interface RemovesWhere
{
    /**
     * Removes every document of the model's index whose `$field` equals `$value`.
     *
     * @param  Model  $model  a model with Scout's Searchable (only its index counts)
     */
    public function removeWhere(Model $model, string $field, string $value): void;
}
