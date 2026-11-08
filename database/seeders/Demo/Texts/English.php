<?php

namespace Database\Seeders\Demo\Texts;

/**
 * The English texts of the demo, the counterpart of German: the same keys, the same fictional team, now Fieldwork. The
 * shipped catalog entries (the workflow Standard, Task, Bug, Epic, the effort and the built-in relation types) carry
 * the texts of `catalog.builtin.*` in lang/en.json, the way the German ones carry those of lang/de.json.
 */
final class English
{
    /** @var array<string, string> */
    public const TEXTS = [
        'organization.name' => 'Fieldwork',
        'organization.mail_domain' => 'fieldwork.example.com',

        'person.mara.name' => 'Mara Lindley',
        'person.jonas.name' => 'Jonas Field',
        'person.ida.name' => 'Ida Brennan',
        'person.theo.name' => 'Theo Okafor',
        'person.lene.name' => 'Lene Vaughan',
        'person.sven.name' => 'Sven Albright',

        'bot.kira.name' => 'Kira',
        'bot.kira.description' => 'Mara’s bot. Works on the items assigned to it over MCP.',

        'catalog.workflow.standard.name' => 'Standard',
        'catalog.workflow.standard.description' => 'The default workflow: every status can be reached from anywhere.',
        'catalog.workflow.agency.name' => 'Agency approval',
        'catalog.workflow.agency.description' => 'With an internal review and the client’s approval before it is done.',

        'catalog.state.backlog' => 'Backlog',
        'catalog.state.todo' => 'Todo',
        'catalog.state.progress' => 'In Progress',
        'catalog.state.review' => 'Review',
        'catalog.state.approval' => 'Client approval',
        'catalog.state.done' => 'Done',
        'catalog.state.cancelled' => 'Cancelled',

        'catalog.property.customer.label' => 'Client',
        'catalog.property.customer.help' => 'Who the item is for.',
        'catalog.property.customer.option.nordlicht' => 'Studio Northlight',
        'catalog.property.customer.option.hafenkontor' => 'Harbour Office',
        'catalog.property.customer.option.moos' => 'Moss Nursery',
        'catalog.property.effort.label' => 'Effort (h)',
        'catalog.property.effort.help' => 'Estimated hours, to one decimal place.',
        'catalog.property.environment.label' => 'Environment',
        'catalog.property.environment.help' => 'Where the bug occurred.',
        'catalog.property.environment.option.prod' => 'Production',
        'catalog.property.environment.option.staging' => 'Staging',
        'catalog.property.environment.option.local' => 'Local',
        'catalog.property.browser.label' => 'Browser',
        'catalog.property.browser.help' => 'Browser and version, e.g. “Safari 18 on iOS”.',
        'catalog.property.ticket_url.label' => 'Client ticket',
        'catalog.property.ticket_url.help' => 'Link to the ticket in the client’s own system.',
        'catalog.property.approved.label' => 'Signed off',
        'catalog.property.approved.help' => 'The client has signed off on the work.',
        'catalog.property.reviewer.label' => 'Reviewer',
        'catalog.property.reviewer.help' => 'Who checks the result.',
        'catalog.property.steps.label' => 'Steps to reproduce',
        'catalog.property.steps.help' => 'How to make the bug happen again.',
        'catalog.property.target_quarter.label' => 'Target quarter',
        'catalog.property.target_quarter.help' => 'When the undertaking should be done.',
        'catalog.property.target_quarter.option.q4_2026' => 'Q4 2026',
        'catalog.property.target_quarter.option.q1_2027' => 'Q1 2027',
        'catalog.property.target_quarter.option.q2_2027' => 'Q2 2027',

        'catalog.type.task.name' => 'Task',
        'catalog.type.task.description' => 'A task somebody gets done.',
        'catalog.type.bug.name' => 'Bug',
        'catalog.type.bug.description' => 'A defect that needs fixing. The environment it occurs in is required.',
        'catalog.type.epic.name' => 'Epic',
        'catalog.type.epic.description' => 'A larger undertaking that breaks down into items. Shows on the timeline.',
        'catalog.type.wish.name' => 'Client request',
        'catalog.type.wish.description' => 'A request from a client, approved before the work starts.',

        'catalog.label.ux' => 'UX',
        'catalog.label.forms' => 'Forms',
        'catalog.label.production' => 'Production',
        'catalog.label.performance' => 'Performance',
        'catalog.label.seo' => 'SEO',
        'catalog.label.a11y' => 'Accessibility',
        'catalog.label.backend' => 'Backend',
        'catalog.label.design' => 'Design',

        'catalog.relation.blocks.name' => 'blocks',
        'catalog.relation.blocks.outward' => 'blocks',
        'catalog.relation.blocks.inward' => 'is blocked by',
        'catalog.relation.duplicates.name' => 'Duplicate',
        'catalog.relation.duplicates.outward' => 'duplicates',
        'catalog.relation.duplicates.inward' => 'is duplicated by',
        'catalog.relation.relates.name' => 'related',
        'catalog.relation.relates.outward' => 'relates to',
        'catalog.relation.tests.name' => 'tests',
        'catalog.relation.tests.outward' => 'tests',
        'catalog.relation.tests.inward' => 'is tested by',

        'project.WEB.name' => 'Website relaunch',
        'project.WEB.description' => 'A new website: structure, design, technology and the move to the new server.',
        'project.APP.name' => 'Client app',
        'project.APP.description' => 'The app for orders and questions. Version 2.0 is in beta.',
        'project.OPS.name' => 'Infrastructure',
        'project.OPS.description' => 'Servers, operations and backups. For the tech team only.',

        'view.due_week.name' => 'Due this week',
        'view.prod_bugs.name' => 'Bugs in production',
        'view.kira.name' => 'For Kira',
        'view.nordlicht.name' => 'Studio Northlight',
        'view.roadmap.name' => 'Roadmap',
        'view.blocked.name' => 'Blocked',

        'token.claude_code.name' => 'Claude Code',
        'token.ci_script.name' => 'CI script',
        'token.mcp.name' => 'MCP',
    ];
}
