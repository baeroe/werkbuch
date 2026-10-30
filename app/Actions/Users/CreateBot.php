<?php

namespace App\Actions\Users;

use App\Access\Authorize;
use App\Access\OrgRole;
use App\Access\RoleAssignments;
use App\Enums\AccountType;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Models\User;
use App\Support\AccountInput;
use App\Support\Actor;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Creates a bot (org admins): name, handle, optionally a description and the responsible person, by default the
 * admin who creates it; that has to be an active person. A new bot is a member of the organization.
 */
final class CreateBot
{
    use AsAction;

    public function __construct(private readonly RoleAssignments $roles) {}

    /**
     * @param  array<string, mixed>  $input
     *
     * @throws ValidationException
     */
    public function handle(Actor $actor, array $input): User
    {
        Authorize::check($actor, 'createBot', User::class);

        foreach (['name', 'description'] as $field) {
            if (is_string($input[$field] ?? null)) {
                $input[$field] = trim($input[$field]);
            }
        }

        $input['owner_id'] ??= $actor->user->id;

        $valid = Validator::make($input, [
            'name' => ['required', 'string', 'max:'.AccountInput::NAME_MAX],
            'handle' => AccountInput::handle(),
            'description' => ['nullable', 'string', 'max:'.AccountInput::DESCRIPTION_MAX],
            'owner_id' => ['required', 'string', AccountInput::owner()],
        ], AccountInput::messages())->validate();

        return DB::transaction(function () use ($actor, $valid): User {
            $bot = User::query()->create([
                'type' => AccountType::Bot,
                'name' => $valid['name'],
                'handle' => $valid['handle'],
                'is_default_bot' => false,
                'owner_id' => $valid['owner_id'],
                'description' => $valid['description'] ?? null,
            ]);

            $this->roles->setOrgRole($bot, OrgRole::Member);
            EventRecorder::record(EventType::BotCreated, $actor, $bot, null);

            return $bot;
        });
    }
}
