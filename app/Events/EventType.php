<?php

namespace App\Events;

/**
 * Every kind of domain event. The values are the names of the webhook catalog (Spec 6.3, P11); events without a webhook
 * (`webhook()` false) feed history, notifications and search only.
 */
enum EventType: string
{
    case ProjectCreated = 'project.created';
    case ProjectUpdated = 'project.updated';
    case ProjectArchived = 'project.archived';
    case ProjectRestored = 'project.restored';
    case ProjectDeleted = 'project.deleted';
    case ProjectMemberAdded = 'project.member_added';
    case ProjectMemberRemoved = 'project.member_removed';
    case ProjectMemberRoleChanged = 'project.member_role_changed';

    case WorkItemCreated = 'work_item.created';
    case WorkItemUpdated = 'work_item.updated';
    case WorkItemStateChanged = 'work_item.state_changed';
    case WorkItemAssigned = 'work_item.assigned';
    case WorkItemArchived = 'work_item.archived';
    case WorkItemRestored = 'work_item.restored';
    case WorkItemDeleted = 'work_item.deleted';
    case WorkItemRelationAdded = 'work_item.relation_added';
    case WorkItemRelationRemoved = 'work_item.relation_removed';

    case CommentCreated = 'comment.created';
    case CommentUpdated = 'comment.updated';
    case CommentDeleted = 'comment.deleted';

    case PageCreated = 'page.created';
    case PageUpdated = 'page.updated';
    case PageMoved = 'page.moved';
    case PageDeleted = 'page.deleted';

    case BotMentioned = 'bot.mentioned';
    case BotAssigned = 'bot.assigned';
    case BotCreated = 'bot.created';

    case TemplateRunFailed = 'template.run_failed';

    case OrganizationUpdated = 'organization.updated';

    case WorkflowCreated = 'workflow.created';
    case WorkflowUpdated = 'workflow.updated';
    case WorkflowDeleted = 'workflow.deleted';

    case WorkItemTypeCreated = 'work_item_type.created';
    case WorkItemTypeUpdated = 'work_item_type.updated';
    case WorkItemTypeDeleted = 'work_item_type.deleted';

    case PropertyCreated = 'property.created';
    case PropertyUpdated = 'property.updated';
    case PropertyDeleted = 'property.deleted';

    case LabelCreated = 'label.created';
    case LabelUpdated = 'label.updated';
    case LabelDeleted = 'label.deleted';

    case RelationTypeCreated = 'relation_type.created';
    case RelationTypeUpdated = 'relation_type.updated';
    case RelationTypeDeleted = 'relation_type.deleted';

    case ResolutionCreated = 'resolution.created';
    case ResolutionUpdated = 'resolution.updated';
    case ResolutionDeleted = 'resolution.deleted';

    case UserCreated = 'user.created';
    case UserUpdated = 'user.updated';
    case UserRoleChanged = 'user.role_changed';
    case UserDeactivated = 'user.deactivated';
    case UserReactivated = 'user.reactivated';
    case UserInvited = 'user.invited';
    case UserPasswordChanged = 'user.password_changed';
    case UserTwoFactorSetupStarted = 'user.two_factor_setup_started';
    case UserTwoFactorSetupCancelled = 'user.two_factor_setup_cancelled';
    case UserTwoFactorEnabled = 'user.two_factor_enabled';
    case UserTwoFactorDisabled = 'user.two_factor_disabled';
    case UserRecoveryCodesRegenerated = 'user.recovery_codes_regenerated';
    case UserRecoveryCodeUsed = 'user.recovery_code_used';

    case TokenCreated = 'token.created';
    case TokenRevoked = 'token.revoked';

    case FavoriteAdded = 'favorite.added';
    case FavoriteRemoved = 'favorite.removed';

    /**
     * Whether webhooks can subscribe to this event.
     */
    public function webhook(): bool
    {
        return match ($this) {
            self::ProjectCreated, self::ProjectUpdated, self::ProjectArchived, self::ProjectRestored, self::ProjectDeleted,
            self::ProjectMemberAdded, self::ProjectMemberRemoved,
            self::WorkItemCreated, self::WorkItemUpdated, self::WorkItemStateChanged, self::WorkItemAssigned,
            self::WorkItemArchived, self::WorkItemRestored, self::WorkItemDeleted, self::WorkItemRelationAdded,
            self::WorkItemRelationRemoved,
            self::CommentCreated, self::CommentUpdated, self::CommentDeleted,
            self::PageCreated, self::PageUpdated, self::PageMoved, self::PageDeleted,
            self::BotMentioned, self::BotAssigned,
            self::TemplateRunFailed => true,
            default => false,
        };
    }

    /**
     * The part before the dot (`work_item` for `work_item.state_changed`): the group a webhook subscribes with `group.*`.
     */
    public function group(): string
    {
        return explode('.', $this->value, 2)[0];
    }
}
