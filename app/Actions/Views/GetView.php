<?php

namespace App\Actions\Views;

use App\Access\Authorize;
use App\Exceptions\Problem;
use App\Models\View;
use App\Support\Actor;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * One view, as it is stored: a view whose property is gone meanwhile still answers (its condition matches nothing,
 * `View::filter()`). Every account reads it.
 */
final class GetView
{
    use AsAction;

    /**
     * @throws Problem
     */
    public function handle(Actor $actor, View $view): View
    {
        Authorize::check($actor, 'view', $view);

        return $view;
    }
}
