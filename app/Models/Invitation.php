<?php

namespace App\Models;

use App\Access\OrgRole;
use Database\Factories\InvitationFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * An invitation to the organization: the address, the role in the organization and the projects to join (with their
 * role) once it is accepted. The link is not stored, App\Support\InvitationLinks derives it from the ULID.
 *
 * @property string $id
 * @property string $email
 * @property OrgRole $org_role
 * @property list<array{project_id: string, role: string}> $projects
 * @property string|null $invited_by
 * @property Carbon $expires_at
 * @property Carbon|null $accepted_at
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['email', 'org_role', 'projects', 'invited_by', 'expires_at', 'accepted_at'])]
final class Invitation extends Model
{
    /** @use HasFactory<InvitationFactory> */
    use HasFactory, HasUlids;

    /** How long an invitation can be accepted (spec 4.2). */
    public const VALID_DAYS = 7;

    /**
     * The invitations nobody accepted and that have not run out.
     *
     * @param  Builder<self>  $query
     */
    public function scopeOpen(Builder $query): void
    {
        $query->whereNull('accepted_at')->where('expires_at', '>', now());
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function inviter(): BelongsTo
    {
        return $this->belongsTo(User::class, 'invited_by');
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'org_role' => OrgRole::class,
            'projects' => 'array',
            'expires_at' => 'datetime',
            'accepted_at' => 'datetime',
        ];
    }
}
