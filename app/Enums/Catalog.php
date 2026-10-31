<?php

namespace App\Enums;

/**
 * The six catalogs of the organization. Only org admins change them (`org.manage_catalog`); the enum names the sentence
 * the refusal carries, one per catalog.
 */
enum Catalog: string
{
    case Workflows = 'workflows';
    case WorkItemTypes = 'work_item_types';
    case Properties = 'properties';
    case Labels = 'labels';
    case RelationTypes = 'relation_types';
    case Resolutions = 'resolutions';

    /**
     * The sentence of the refusal, translated.
     */
    public function deniedDetail(): string
    {
        return match ($this) {
            self::Workflows => __('problem.detail.workflows_admins_only'),
            self::WorkItemTypes => __('problem.detail.types_admins_only'),
            self::Properties => __('problem.detail.properties_admins_only'),
            self::Labels => __('problem.detail.labels_admins_only'),
            self::RelationTypes => __('problem.detail.relation_types_admins_only'),
            self::Resolutions => __('problem.detail.resolutions_admins_only'),
        };
    }
}
