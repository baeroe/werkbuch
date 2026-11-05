<?php

namespace App\Actions\Templates;

use App\Access\Authorize;
use App\Exceptions\Problem;
use App\Models\Template;
use App\Support\Actor;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * One template with its texts for the reader (`GET /api/v1/templates/{template}`): whoever sees its project (viewers
 * and outsiders of a public one too), anyone else gets a 404.
 */
final class GetTemplate
{
    use AsAction;

    /**
     * @throws Problem
     */
    public function handle(Actor $actor, Template $template): Template
    {
        Authorize::check($actor, 'view', $template);
        Template::loadForResource($template, $actor->user);

        return $template;
    }
}
