<?php

namespace Database\Seeders\Demo\Texts;

/**
 * The German texts of the demo, as the clickdummy has them (src/api/seed/*.ts). The keys are the same in English.
 */
final class German
{
    /** @var array<string, string> */
    public const TEXTS = [
        'organization.name' => 'Feldwerk',
        'organization.mail_domain' => 'feldwerk.example.com',

        'person.mara.name' => 'Mara Lindqvist',
        'person.jonas.name' => 'Jonas Feld',
        'person.ida.name' => 'Ida Brenner',
        'person.theo.name' => 'Theo Okafor',
        'person.lene.name' => 'Lene Vogt',
        'person.sven.name' => 'Sven Albers',

        'bot.kira.name' => 'Kira',
        'bot.kira.description' => 'Bot von Mara. Bearbeitet per MCP die Items, die ihm zugewiesen sind.',

        'catalog.workflow.standard.name' => 'Standard',
        'catalog.workflow.standard.description' => 'Der Standard-Workflow: Jeder Status ist von überall erreichbar.',
        'catalog.workflow.agency.name' => 'Agentur-Freigabe',
        'catalog.workflow.agency.description' => 'Mit interner Prüfung und Kundenfreigabe vor dem Abschluss.',

        'catalog.state.backlog' => 'Backlog',
        'catalog.state.todo' => 'Todo',
        'catalog.state.progress' => 'In Progress',
        'catalog.state.review' => 'Review',
        'catalog.state.approval' => 'Kundenfreigabe',
        'catalog.state.pending' => 'Pending',
        'catalog.state.done' => 'Done',
        'catalog.state.cancelled' => 'Cancelled',

        'catalog.property.customer.label' => 'Kunde',
        'catalog.property.customer.help' => 'Für wen das Item gemacht wird.',
        'catalog.property.customer.option.nordlicht' => 'Studio Nordlicht',
        'catalog.property.customer.option.hafenkontor' => 'Hafenkontor',
        'catalog.property.customer.option.moos' => 'Gärtnerei Moos',
        'catalog.property.effort.label' => 'Aufwand (h)',
        'catalog.property.effort.help' => 'Geschätzte Stunden, auf eine Nachkommastelle.',
        'catalog.property.environment.label' => 'Umgebung',
        'catalog.property.environment.help' => 'Wo der Fehler aufgetreten ist.',
        'catalog.property.environment.option.prod' => 'Produktion',
        'catalog.property.environment.option.staging' => 'Staging',
        'catalog.property.environment.option.local' => 'Lokal',
        'catalog.property.browser.label' => 'Browser',
        'catalog.property.browser.help' => 'Browser und Version, z. B. „Safari 18 auf iOS“.',
        'catalog.property.ticket_url.label' => 'Ticket beim Kunden',
        'catalog.property.ticket_url.help' => 'Link auf das Ticket im System des Kunden.',
        'catalog.property.approved.label' => 'Abgenommen',
        'catalog.property.approved.help' => 'Der Kunde hat die Umsetzung abgenommen.',
        'catalog.property.reviewer.label' => 'Reviewer',
        'catalog.property.reviewer.help' => 'Wer das Ergebnis prüft.',
        'catalog.property.steps.label' => 'Schritte zum Nachstellen',
        'catalog.property.steps.help' => 'So lässt sich der Fehler reproduzieren.',
        'catalog.property.target_quarter.label' => 'Zielquartal',
        'catalog.property.target_quarter.help' => 'Bis wann das Vorhaben fertig sein soll.',
        'catalog.property.target_quarter.option.q4_2026' => 'Q4 2026',
        'catalog.property.target_quarter.option.q1_2027' => 'Q1 2027',
        'catalog.property.target_quarter.option.q2_2027' => 'Q2 2027',

        'catalog.type.task.name' => 'Task',
        'catalog.type.task.description' => 'Eine Aufgabe, die jemand erledigt.',
        'catalog.type.bug.name' => 'Bug',
        'catalog.type.bug.description' => 'Ein Fehler, der behoben werden muss. Die Umgebung, in der er auftritt, ist Pflicht.',
        'catalog.type.epic.name' => 'Epic',
        'catalog.type.epic.description' => 'Ein größeres Vorhaben, das in Items zerfällt. Erscheint in der Timeline.',
        'catalog.type.wish.name' => 'Kundenwunsch',
        'catalog.type.wish.description' => 'Ein Wunsch einer Kundin oder eines Kunden, der vor der Umsetzung freigegeben wird.',

        'catalog.label.ux' => 'UX',
        'catalog.label.forms' => 'Formulare',
        'catalog.label.production' => 'Produktion',
        'catalog.label.performance' => 'Performance',
        'catalog.label.seo' => 'SEO',
        'catalog.label.a11y' => 'Barrierefreiheit',
        'catalog.label.backend' => 'Backend',
        'catalog.label.design' => 'Design',

        'catalog.relation.blocks.name' => 'blockiert',
        'catalog.relation.blocks.outward' => 'blockiert',
        'catalog.relation.blocks.inward' => 'wird blockiert von',
        'catalog.relation.duplicates.name' => 'Duplikat',
        'catalog.relation.duplicates.outward' => 'ist Duplikat von',
        'catalog.relation.duplicates.inward' => 'hat Duplikat',
        'catalog.relation.relates.name' => 'verwandt',
        'catalog.relation.relates.outward' => 'verwandt mit',
        'catalog.relation.tests.name' => 'testet',
        'catalog.relation.tests.outward' => 'testet',
        'catalog.relation.tests.inward' => 'wird getestet von',

        'project.WEB.name' => 'Website-Relaunch',
        'project.WEB.description' => 'Neuer Webauftritt: Struktur, Gestaltung, Technik und der Umzug auf den neuen Server.',
        'project.APP.name' => 'Kunden-App',
        'project.APP.description' => 'Die App für Bestellungen und Rückfragen. Version 2.0 ist in der Beta.',
        'project.OPS.name' => 'Infrastruktur',
        'project.OPS.description' => 'Server, Betrieb und Backups. Nur für das Technik-Team.',

        'view.due_week.name' => 'Fällig diese Woche',
        'view.prod_bugs.name' => 'Bugs in Produktion',
        'view.kira.name' => 'Für Kira',
        'view.nordlicht.name' => 'Studio Nordlicht',
        'view.roadmap.name' => 'Roadmap',
        'view.blocked.name' => 'Blockiert',

        'token.claude_code.name' => 'Claude Code',
        'token.ci_script.name' => 'CI-Skript',
        'token.mcp.name' => 'MCP',
    ];
}
