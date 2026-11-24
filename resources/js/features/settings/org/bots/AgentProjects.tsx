/*
 * The projects of an agent (spec 10.4, Bot → Agent): the projects the bot is a member of, by name, each with whether the
 * agent works there and, where not, why (`agentProjectReason` as `AgentFlow::refusal`: it only reads there, the project
 * is archived, its workflow lacks a step of the agents). Without a membership the card says how to add the bot. Org
 * admins see every project, so the list is whole; the memberships come with `include=members` in one call.
 */

import { Link } from '@inertiajs/react';
import { CircleCheck, CircleMinus } from 'lucide-react';
import { agentProjectReason, type AgentProjectReason } from '@/domain/agents';
import { useProjects } from '@/hooks/projects';
import { useWorkflows } from '@/hooks/workflows';
import { intlLocale, t, type TranslationKey } from '@/lib/i18n';
import { paths } from '@/lib/links';
import type { User } from '@/types';
import { Loaded, SettingsCard } from '../../frame/parts';

const REASONS: Record<AgentProjectReason, TranslationKey> = {
  viewer: 'settings.bot_agent.projects.reason.viewer',
  archived: 'settings.bot_agent.projects.reason.archived',
  steps: 'settings.bot_agent.projects.reason.steps',
};

const linkClass = 'font-medium text-accent-text underline-offset-2 hover:underline';

export function AgentProjects({ bot }: { bot: User }) {
  const projects = useProjects({ include_archived: true, include: 'members' });
  const workflows = useWorkflows();
  return (
    <SettingsCard title={t('settings.bot_agent.projects.title')} description={t('settings.bot_agent.projects.description')}>
      <Loaded queries={[projects, workflows]} failure={t('settings.bot_agent.projects.load_failed')} skeleton={<p className="text-ui text-muted">{t('settings.frame.loading')}</p>}>
        {() => {
          const collator = new Intl.Collator(intlLocale());
          const mine = projects
            .data!.items.flatMap((project) => {
              const member = project.members?.find((entry) => entry.user_id === bot.id);
              if (!member) return [];
              const workflow = workflows.data!.items.find((entry) => entry.id === project.workflow_id);
              return [{ project, reason: agentProjectReason(member.role, project, workflow) }];
            })
            .sort((a, b) => collator.compare(a.project.name, b.project.name));
          if (mine.length === 0) return <p className="max-w-[65ch] text-ui text-pretty text-muted">{t('settings.bot_agent.projects.none', { name: bot.name })}</p>;
          return (
            <ul className="flex flex-col gap-2" aria-label={t('settings.bot_agent.projects.list', { name: bot.name })}>
              {mine.map(({ project, reason }) => (
                <li key={project.id} className="flex items-start gap-2.5">
                  {reason === null ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-st-completed" aria-hidden="true" /> : <CircleMinus className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden="true" />}
                  <div className="min-w-0 text-ui">
                    <p className="text-ink">
                      <Link href={paths.projectSettings(project.identifier, 'agents')} className={linkClass}>
                        <span className="font-semibold tabular-nums" translate="no">
                          {project.identifier}
                        </span>{' '}
                        {project.name}
                      </Link>
                      <span className="sr-only">{reason === null ? t('settings.bot_agent.projects.works_sr') : t('settings.bot_agent.projects.not_sr')}</span>
                    </p>
                    <p className="text-sm text-pretty text-muted">{reason === null ? t('settings.bot_agent.projects.works') : t(REASONS[reason])}</p>
                  </div>
                </li>
              ))}
            </ul>
          );
        }}
      </Loaded>
    </SettingsCard>
  );
}
