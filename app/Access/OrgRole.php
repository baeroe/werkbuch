<?php

namespace App\Access;

/**
 * The role of an account in the organization (spec 4.3). At spatie it is a global role assigned in the team of the
 * organization.
 */
enum OrgRole: string
{
    case Admin = 'admin';
    case Member = 'member';

    /**
     * The name of the role at spatie.
     */
    public function roleName(): string
    {
        return 'org-'.$this->value;
    }

    public static function fromRoleName(string $name): ?self
    {
        return str_starts_with($name, 'org-') ? self::tryFrom(substr($name, strlen('org-'))) : null;
    }

    /**
     * The order of the roles: a higher rank may do everything a lower one may.
     */
    public function rank(): int
    {
        return match ($this) {
            self::Member => 0,
            self::Admin => 1,
        };
    }
}
