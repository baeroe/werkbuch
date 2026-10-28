/*
 * The settings of the organisation (spec 5.2): a list of sections on the left, the chosen section on the right. Below
 * the lg breakpoint (a phone, a tablet beside the sidebar) the list is a row of links above the section, so the section
 * keeps the room. `/settings` leads to Allgemein; an unknown section says so and
 * keeps the list. Admins change everything; a member reads the catalogs and the general settings and is told
 * "Nur für Admins" in the sections that are not theirs.
 */

import { CircleAlert, Lock, Settings } from 'lucide-react';
import { useEffect, useRef, type ComponentType } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { buttonClass } from '@/components/ui/Button';
import { cx } from '@/components/ui/cx';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { useCurrentUser } from '@/hooks/users';
import { useCommand } from '@/lib/commands';
import { useDocumentTitle } from '@/lib/useDocumentTitle';
import { NotForMembers, useOrgRight } from './access';
import Bots from './Bots';
import General from './General';
import Labels from './Labels';
import { FormSkeleton, SectionHeader } from './parts';
import People from './People';
import Properties from './Properties';
import RelationTypes from './RelationTypes';
import Resolutions from './Resolutions';
import { findSection, GROUP_NAMES, SECTIONS, type SectionDef, type SectionGroup, type SectionProps, type SectionSlug } from './sections';
import System from './System';
import Types from './Types';
import Webhooks from './Webhooks';
import Workflows from './Workflows';

const COMPONENTS: Record<SectionSlug, ComponentType<SectionProps>> = {
  general: General,
  people: People,
  bots: Bots,
  workflows: Workflows,
  types: Types,
  properties: Properties,
  labels: Labels,
  'relation-types': RelationTypes,
  resolutions: Resolutions,
  webhooks: Webhooks,
  system: System,
};

const GROUPS: SectionGroup[] = ['organization', 'catalogs', 'operations'];

/** The list of sections: vertical from lg on, a row that scrolls sideways below it. */
function SectionNav({ current, memberLocks }: { current: SectionSlug | null; memberLocks: boolean }) {
  const active = useRef<HTMLAnchorElement>(null);

  // on a phone the row scrolls: the current section has to be in view
  useEffect(() => {
    active.current?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
  }, [current]);

  return (
    <nav aria-label="Bereiche der Einstellungen" className="-mx-4 overflow-x-auto px-4 py-1 lg:sticky lg:top-3 lg:mx-0 lg:overflow-visible lg:px-0 lg:py-0">
      <div className="flex gap-4 lg:flex-col lg:gap-5">
        {GROUPS.map((group) => (
          <div key={group} className="flex shrink-0 items-center gap-1 lg:flex-col lg:items-stretch">
            <p className="hidden px-2 pb-1 text-sm font-semibold text-muted lg:block">{GROUP_NAMES[group]}</p>
            <ul className="flex gap-1 lg:flex-col">
              {SECTIONS.filter((section) => section.group === group).map((section) => {
                const isCurrent = section.slug === current;
                const locked = memberLocks && section.members === 'blocked';
                return (
                  <li key={section.slug}>
                    <Link
                      ref={isCurrent ? active : undefined}
                      to={`/settings/${section.slug}`}
                      aria-current={isCurrent ? 'page' : undefined}
                      className={cx(
                        'flex h-11 items-center gap-2 rounded-ctl px-2.5 text-ui whitespace-nowrap transition-colors duration-120 lg:h-8 lg:px-2',
                        isCurrent ? 'bg-raised text-ink shadow-elev-1 ring-1 ring-line-input ring-inset' : 'text-ink hover:bg-hover',
                      )}
                    >
                      <section.icon className={cx('size-4 shrink-0', isCurrent ? 'text-accent-text' : 'text-muted')} aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate">{section.label}</span>
                      {locked && (
                        <>
                          <Lock className="size-3 shrink-0 text-faint" aria-hidden="true" />
                          <span className="sr-only">nur für Admins</span>
                        </>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}

/** The chosen section, once the rights are known: its screen, a notice for members, or the reason it could not load. */
function SectionBody({ section }: { section: SectionDef }) {
  const right = useOrgRight(section.permission);

  if (right.status === 'error') {
    return <ErrorState title="Die Rechte konnten nicht geladen werden" description="Ohne sie weiß die Seite nicht, was du hier ändern darfst." retrying={right.retrying} onRetry={right.retry} />;
  }
  if (right.status === 'loading') {
    return (
      <div className="flex flex-col gap-4">
        <SectionHeader title={section.label} />
        <FormSkeleton label={`${section.label} wird geladen …`} />
      </div>
    );
  }
  if (right.reason !== null && section.members === 'blocked') {
    return (
      <div className="flex flex-col gap-4">
        <SectionHeader title={section.label} />
        <NotForMembers reason={right.reason} section={`„${section.label}“`} />
      </div>
    );
  }
  const Section = COMPONENTS[section.slug];
  return <Section readOnlyReason={right.reason} />;
}

function UnknownSection({ slug }: { slug: string }) {
  return (
    <EmptyState
      icon={CircleAlert}
      title="Diesen Bereich gibt es nicht"
      description={`„${slug}“ gehört nicht zu den Einstellungen der Organisation. Die Liste links zeigt, was es gibt.`}
      actions={
        <Link to="/settings/general" className={buttonClass({ variant: 'primary' })}>
          Zu Allgemein
        </Link>
      }
    />
  );
}

export default function OrgSettingsRoute() {
  const { section: slug } = useParams();
  const navigate = useNavigate();
  const me = useCurrentUser();
  const current = findSection(slug);
  useDocumentTitle(current ? `${current.label} – Einstellungen` : 'Einstellungen');

  // from anywhere in the settings the palette can jump to a section
  useCommand(
    {
      id: 'settings.section',
      label: 'Einstellungsbereich wählen …',
      group: 'Einstellungen',
      icon: <Settings />,
      keywords: ['bereich', 'organisation', 'einstellungen'],
      run: () => {},
      subpage: () => ({
        placeholder: 'Bereich wählen …',
        options: SECTIONS.map((section) => ({
          id: section.slug,
          label: section.label,
          icon: <section.icon />,
          hint: section.slug === current?.slug ? 'aktuell' : undefined,
          keywords: section.keywords,
          run: () => navigate(`/settings/${section.slug}`),
        })),
      }),
    },
    [current?.slug],
  );

  if (!slug) return <Navigate to="/settings/general" replace />;

  return (
    <div className="mx-auto w-full max-w-6xl">
      <div className="flex h-8 items-center">
        <h1 className="truncate font-display text-lg font-bold tracking-title text-ink">Einstellungen</h1>
      </div>
      <div className="mt-3 grid items-start gap-3 lg:grid-cols-[12.5rem_minmax(0,1fr)] lg:gap-8">
        <SectionNav current={current?.slug ?? null} memberLocks={me?.org_role === 'member'} />
        <div className="min-w-0 lg:pt-1">{current ? <SectionBody key={current.slug} section={current} /> : <UnknownSection slug={slug} />}</div>
      </div>
    </div>
  );
}
