<?php

namespace Tests\Feature\Access;

use App\Access\ProjectRole;
use App\Access\RoleAssignments;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use Illuminate\Support\Facades\Storage;
use InvalidArgumentException;
use Spatie\MediaLibrary\MediaCollections\Models\Media;

/**
 * The world every row of the rights matrix runs in: the organization with a logo, the public project WEB and the private
 * project OPS, and one account per column. `project($column)` is the project a column acts on: OPS for the outsider of
 * the private project, WEB for everybody else.
 */
final class MatrixWorld
{
    /** The columns of the matrix, one kind of account each. */
    public const COLUMNS = [
        'org_admin', 'project_admin', 'project_member', 'project_viewer', 'outsider_public', 'outsider_private', 'default_bot',
    ];

    public const PASSWORD = 'matrix-password';

    /**
     * @param  array<string, User>  $accounts
     */
    private function __construct(
        private readonly array $accounts,
        public readonly Project $web,
        public readonly Project $ops,
        /** Another person, member of WEB, not its lead: the account rows act on. */
        public readonly User $target,
        /** A bot run by the project admin. */
        public readonly User $bot,
        public readonly Media $logo,
    ) {}

    public static function build(): self
    {
        Storage::fake('local');

        $person = fn (string $name) => User::factory()->create(['name' => $name, 'password' => self::PASSWORD]);

        $orgAdmin = User::factory()->admin()->create(['name' => 'Org Admin', 'password' => self::PASSWORD]);
        $projectAdmin = $person('Project Admin');
        $member = $person('Project Member');
        $viewer = $person('Project Viewer');
        $target = $person('Target');

        $web = Project::factory()->identifier('WEB')->public()->create(['lead_id' => $projectAdmin->id]);
        $ops = Project::factory()->identifier('OPS')->private()->create(['lead_id' => $projectAdmin->id]);

        $roles = app(RoleAssignments::class);

        foreach ([$web, $ops] as $project) {
            $roles->setProjectRole($projectAdmin, $project, ProjectRole::Admin);
            $roles->setProjectRole($member, $project, ProjectRole::Member);
            $roles->setProjectRole($viewer, $project, ProjectRole::Viewer);
        }

        $roles->setProjectRole($target, $web, ProjectRole::Member);

        return new self(
            [
                'org_admin' => $orgAdmin,
                'project_admin' => $projectAdmin,
                'project_member' => $member,
                'project_viewer' => $viewer,
                'outsider_public' => $person('Outsider Public'),
                'outsider_private' => $person('Outsider Private'),
                'default_bot' => User::defaultBot(),
            ],
            $web,
            $ops,
            $target,
            User::factory()->bot($projectAdmin)->create(['name' => 'Matrix Bot']),
            Organization::current()->addMediaFromBase64(imageDataUrl())->usingFileName('logo.png')->toMediaCollection('logo'),
        );
    }

    public function account(string $column): User
    {
        return $this->accounts[$column] ?? throw new InvalidArgumentException("Unknown matrix column [{$column}].");
    }

    /**
     * The project the column acts on: OPS for the outsider of the private project, WEB for everybody else.
     */
    public function project(string $column): Project
    {
        return $column === 'outsider_private' ? $this->ops : $this->web;
    }
}
