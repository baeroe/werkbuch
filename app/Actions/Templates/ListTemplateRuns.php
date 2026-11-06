<?php

namespace App\Actions\Templates;

use App\Access\Authorize;
use App\Exceptions\Problem;
use App\Models\Template;
use App\Models\TemplateRun;
use App\Support\Actor;
use App\Support\ListQuery;
use App\Support\ListResult;
use App\Support\ListSpec;
use App\Support\PageArgs;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The log of a template's runs (`GET /api/v1/templates/{template}/runs`) for whoever sees its project (viewers and
 * outsiders of a public project too): newest first (`ran_at` to the microsecond, then id), a page at a time with a
 * cursor.
 */
final class ListTemplateRuns
{
    use AsAction;

    /** A fixed list (A386, K12): no filter, sort or include; it keeps the order it has. */
    public static function spec(): ListSpec
    {
        return ListSpec::fixed();
    }

    /**
     * @param  array<array-key, mixed>  $query  `cursor`, `per_page`
     * @return ListResult<TemplateRun>
     *
     * @throws Problem 404 when the account does not see the template
     * @throws ValidationException at `cursor` or `per_page`
     */
    public function handle(Actor $actor, Template $template, array $query): ListResult
    {
        Authorize::check($actor, 'view', $template);

        $runs = TemplateRun::query()
            // the stamp as the database has it for the cursor: the cast would lose the microseconds (Carbon as text)
            ->select('template_runs.*')->addSelect('template_runs.ran_at as ran_cursor')
            ->where('template_id', $template->id)
            ->orderByDesc('ran_cursor')->orderByDesc('id');

        [$runs, $signature] = ListQuery::apply($runs, $query, self::spec());

        return ListResult::of($runs, PageArgs::from($query), $signature);
    }
}
