<?php

namespace App\Domain\Filter;

use App\Domain\Properties\PropertyShape;

/**
 * The properties of the organisation, as the pure rules of filters, sorts and displays look them up.
 */
interface PropertyCatalog
{
    /** The shape of the property with the key; `null` when there is none. */
    public function shape(string $key): ?PropertyShape;
}
