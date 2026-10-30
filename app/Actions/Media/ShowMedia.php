<?php

namespace App\Actions\Media;

use App\Exceptions\Problem;
use App\Models\Organization;
use App\Models\User;
use App\Support\Actor;
use Illuminate\Database\Eloquent\Relations\Relation;
use Lorisleiva\Actions\Concerns\AsAction;
use Spatie\MediaLibrary\MediaCollections\Models\Media;

/**
 * Who may see a picture (P15): the logo and the avatars every signed-in account. Any other picture, also another
 * collection of the same owners, stays hidden (404) until it brings its rule; project pictures follow the visibility
 * of the project (Task 11).
 */
final class ShowMedia
{
    use AsAction;

    /** The collections every account sees, per owner. */
    private const PUBLIC = [Organization::class => 'logo', User::class => 'avatar'];

    public function handle(Actor $actor, Media $media): Media
    {
        if ((self::PUBLIC[Relation::getMorphedModel($media->model_type) ?? ''] ?? null) !== $media->collection_name) {
            throw Problem::notFound();
        }

        return $media;
    }
}
