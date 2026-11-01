<?php

namespace App\Policies;

use App\Access\Permission;
use App\Access\Visibility;
use App\Models\User;
use App\Models\View;
use Illuminate\Auth\Access\Response;

/**
 * Who may do what with a view (spec 4.3, 4.11). Views belong to the team: every active account sees all of them and
 * may create one (`view.create`, every org role holds it); a view changes and goes only by its creator or by whoever
 * holds `view.manage_any` (org admins), and the refusal names the creator and the view. A deactivated account sees no
 * view at all (over REST it never gets this far: EnsureAccountIsActive).
 */
final class ViewPolicy
{
    public function viewAny(User $user): Response
    {
        return self::active($user) ?? Response::allow();
    }

    public function view(User $user, View $view): Response
    {
        return self::active($user) ?? Response::allow();
    }

    public function create(User $user): Response
    {
        return self::active($user) ?? (Visibility::can($user, Permission::ViewCreate) ? Response::allow() : Response::deny());
    }

    public function update(User $user, View $view): Response
    {
        return self::active($user) ?? self::creatorOrManager($user, $view);
    }

    public function delete(User $user, View $view): Response
    {
        return self::active($user) ?? self::creatorOrManager($user, $view);
    }

    /** The refusal for a deactivated account, `null` for an active one. */
    private static function active(User $user): ?Response
    {
        return $user->isDisabled() ? Response::denyAsNotFound() : null;
    }

    private static function creatorOrManager(User $user, View $view): Response
    {
        if ($view->created_by === $user->id || Visibility::can($user, Permission::ViewManageAny)) {
            return Response::allow();
        }

        return Response::deny(__('problem.detail.view_creator_only', ['name' => $view->creator->name, 'view' => $view->name]));
    }
}
