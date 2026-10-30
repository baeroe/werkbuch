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
 * Who may see a picture (P15): the logo and the avatars every signed-in account. A picture of anything else stays
 * hidden (404) until its owner brings its rule; project pictures follow the visibility of the project (Task 11).
 */
final class ShowMedia
{
    use AsAction;

    /** The owners whose pictures every account sees. */
    private const PUBLIC_OWNERS = [Organization::class, User::class];

    public function handle(Actor $actor, Media $media): Media
    {
        if (! in_array(Relation::getMorphedModel($media->model_type), self::PUBLIC_OWNERS, true)) {
            throw Problem::notFound();
        }

        return $media;
    }
}
