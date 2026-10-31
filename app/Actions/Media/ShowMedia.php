<?php

namespace App\Actions\Media;

use App\Access\Visibility;
use App\Exceptions\Problem;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use App\Support\Actor;
use Illuminate\Database\Eloquent\Relations\Relation;
use Lorisleiva\Actions\Concerns\AsAction;
use Spatie\MediaLibrary\MediaCollections\Models\Media;

/**
 * Who may see a picture (P15): the logo and the avatars every signed-in account; the picture of a project whoever sees
 * the project (App\Access\Visibility), so it never gives away a private project. Any other picture, also another
 * collection of the same owners, stays hidden (404) until it brings its rule.
 */
final class ShowMedia
{
    use AsAction;

    /** The collections every account sees, per owner. */
    private const PUBLIC = [Organization::class => 'logo', User::class => 'avatar'];

    /** The collections whoever sees their project sees, per owner. */
    private const OF_PROJECT = [Project::class => 'image'];

    public function handle(Actor $actor, Media $media): Media
    {
        $owner = Relation::getMorphedModel($media->model_type) ?? '';

        $visible = match ($media->collection_name) {
            self::PUBLIC[$owner] ?? null => true,
            self::OF_PROJECT[$owner] ?? null => $media->model instanceof Project && Visibility::roleIn($actor->user, $media->model) !== null,
            default => false,
        };

        if (! $visible) {
            throw Problem::notFound();
        }

        return $media;
    }
}
