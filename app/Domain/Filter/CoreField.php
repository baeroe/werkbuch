<?php

namespace App\Domain\Filter;

/**
 * The fields of every work item a filter condition can name (plan, table "Filter-Schema"); a property is
 * `property:<key>` instead (`Field::property`).
 */
enum CoreField: string
{
    case Project = 'project';
    case Type = 'type';
    case State = 'state';
    case Assignee = 'assignee';
    case CreatedBy = 'created_by';
    case Parent = 'parent';
    case StateCategory = 'state_category';
    case Priority = 'priority';
    case Label = 'label';
    case StartDate = 'start_date';
    case DueDate = 'due_date';
    case CreatedAt = 'created_at';
    case UpdatedAt = 'updated_at';
    case ClosedAt = 'closed_at';
    case HasChildren = 'has_children';
    case Blocked = 'blocked';
    case Blocking = 'blocking';
    case Archived = 'archived';
    /** The type of the item is an epic. */
    case Epic = 'epic';
    /** The reader watches the item. */
    case Subscribed = 'subscribed';
    case Title = 'title';

    public function kind(): FieldKind
    {
        return match ($this) {
            self::Project, self::Type, self::State, self::Assignee, self::CreatedBy, self::Parent => FieldKind::Id,
            self::StateCategory, self::Priority => FieldKind::Enum,
            self::Label => FieldKind::List,
            self::StartDate, self::DueDate => FieldKind::Date,
            self::CreatedAt, self::UpdatedAt, self::ClosedAt => FieldKind::Stamp,
            self::HasChildren, self::Blocked, self::Blocking, self::Archived, self::Epic, self::Subscribed => FieldKind::Flag,
            self::Title => FieldKind::Text,
        };
    }

    /** Whether an item can have no value here, so that "is empty" means something. */
    public function nullable(): bool
    {
        return match ($this) {
            self::Assignee, self::Parent, self::Label, self::StartDate, self::DueDate, self::ClosedAt => true,
            default => false,
        };
    }

    /** Whether the field takes `me`, the reader. */
    public function acceptsMe(): bool
    {
        return $this === self::Assignee || $this === self::CreatedBy;
    }
}
