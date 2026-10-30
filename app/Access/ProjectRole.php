<?php

namespace App\Access;

/**
 * The role of an account in a project (spec 4.3); `null` (a `?ProjectRole`) means it does not see the project. At
 * spatie it is a global role assigned in the team of the project.
 */
enum ProjectRole: string
{
    case Admin = 'admin';
    case Member = 'member';
    case Viewer = 'viewer';

    /**
     * The name of the role at spatie.
     */
    public function roleName(): string
    {
        return 'project-'.$this->value;
    }

    public static function fromRoleName(string $name): ?self
    {
        return str_starts_with($name, 'project-') ? self::tryFrom(substr($name, strlen('project-'))) : null;
    }

    /**
     * The order of the roles: a higher rank may do everything a lower one may.
     */
    public function rank(): int
    {
        return match ($this) {
            self::Viewer => 0,
            self::Member => 1,
            self::Admin => 2,
        };
    }
}
