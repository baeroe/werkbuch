/*
 * System (spec 5.2, admins only): the version, how far behind the queue is, whether Meilisearch answers, the jobs that
 * failed with their errors and a button to try them all again, and a test mail to the signed-in admin. A mail server
 * that is not set up is said so, and the test mail is not offered, because it could only fail.
 */

import { CircleAlert, CircleCheck, RotateCw, Send } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/toast';
import { useRetryFailedJobs, useSendTestMail, useSystemStatus } from '@/hooks/system';
import { useCurrentUser } from '@/hooks/users';
import { notifyError } from '@/lib/errors';
import type { SystemStatus } from '@/types';
import { causeOf, hasReason } from './errors';
import { counted, formatDateTime, useOrgZone } from './format';
import { Badge, FormSkeleton, Loaded, Panel, Row, Rows, SectionHeader } from './parts';
import type { SectionProps } from './sections';

const NO_MAIL = 'Es ist kein Mailserver eingerichtet.';

function Fact({ label, children, note }: { label: string; children: ReactNode; note?: string }) {
  return (
    <Row>
      <span className="w-44 shrink-0 text-ui text-muted">{label}</span>
      <div className="min-w-0 flex-1 basis-48">
        <div className="text-ui font-medium text-ink">{children}</div>
        {note && <p className="mt-0.5 text-sm text-pretty text-muted">{note}</p>}
      </div>
    </Row>
  );
}

function Ok({ children }: { children: ReactNode }) {
  return <Badge icon={CircleCheck}>{children}</Badge>;
}

function Problem({ children }: { children: ReactNode }) {
  return (
    <Badge tone="danger" icon={CircleAlert}>
      {children}
    </Badge>
  );
}

function Instance({ status }: { status: SystemStatus }) {
  return (
    <Panel title="Instanz">
      <Rows label="Zustand der Instanz">
        <Fact label="Version">
          <span translate="no">{status.version}</span>
        </Fact>
        <Fact label="Queue" note={status.queued_jobs === 0 ? 'Die Queue ist leer, alles ist abgearbeitet.' : 'Aufgaben, die noch laufen müssen, etwa Zustellungen und Mails.'}>
          {counted(status.queued_jobs, 'Job wartet', 'Jobs warten')}
        </Fact>
        <Fact label="Suche (Meilisearch)" note={status.search === 'down' ? 'Die Suche findet nichts, bis Meilisearch wieder antwortet.' : undefined}>
          {status.search === 'ok' ? <Ok>Läuft</Ok> : <Problem>Nicht erreichbar</Problem>}
        </Fact>
        <Fact label="E-Mail">{status.mail_configured ? <Ok>Mailserver eingerichtet</Ok> : <Problem>Nicht eingerichtet</Problem>}</Fact>
      </Rows>
    </Panel>
  );
}

function FailedJobs({ status }: { status: SystemStatus }) {
  const retry = useRetryFailedJobs();
  const zone = useOrgZone();

  function run() {
    retry.mutate(undefined, {
      onSuccess: ({ retried }) => toast({ title: `${counted(retried, 'Job', 'Jobs')} wieder eingereiht`, description: 'Sie laufen mit der nächsten Runde der Queue.', tone: 'success' }),
      onError: (error) => notifyError('Jobs nicht wieder eingereiht', error, run),
    });
  }

  return (
    <Panel
      title={`Fehlgeschlagene Jobs${status.failed_jobs.length > 0 ? ` (${status.failed_jobs.length})` : ''}`}
      description="Was die Queue nach allen Versuchen aufgegeben hat. Prüfe den Fehler, behebe die Ursache und versuche es dann erneut."
      actions={
        status.failed_jobs.length > 0 && (
          <Button variant="secondary" icon={RotateCw} pending={retry.isPending} onClick={run}>
            Alle erneut versuchen
          </Button>
        )
      }
    >
      {status.failed_jobs.length === 0 ? (
        <p className="flex items-center gap-2 px-4 py-3 text-ui text-muted">
          <CircleCheck className="size-4 shrink-0 text-st-completed" aria-hidden="true" />
          Keine fehlgeschlagenen Jobs
        </p>
      ) : (
        <Rows label="Fehlgeschlagene Jobs">
          {status.failed_jobs.map((job) => (
            <Row key={job.id} className="items-start">
              <div className="min-w-0 flex-1 basis-72">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-medium break-all text-ink" translate="no">
                    {job.job}
                  </span>
                  <Badge tone="quiet">{job.queue}</Badge>
                </p>
                <p className="mt-1 text-sm break-words text-muted" translate="no">
                  {job.error}
                </p>
              </div>
              <p className="text-sm text-muted tabular-nums">{formatDateTime(job.failed_at, zone)}</p>
            </Row>
          ))}
        </Rows>
      )}
    </Panel>
  );
}

function TestMail({ status }: { status: SystemStatus }) {
  const me = useCurrentUser();
  const send = useSendTestMail();
  const [refusal, setRefusal] = useState<string | null>(null);

  function run() {
    setRefusal(null);
    send.mutate(undefined, {
      onSuccess: ({ sent_to }) => toast({ title: `Testmail an ${sent_to} gesendet`, description: 'Sie sollte in wenigen Sekunden ankommen.', tone: 'success' }),
      onError: (error) => (hasReason(error, 'mail_not_configured') ? setRefusal(causeOf(error)) : notifyError('Testmail nicht gesendet', error, run)),
    });
  }

  return (
    <Panel title="Testmail" description={`Schickt eine Mail an deine Adresse${me?.email ? ` (${me.email})` : ''}, damit du siehst, ob der Mailserver arbeitet.`}>
      <div className="flex flex-col gap-3 p-4">
        {refusal && (
          <Banner tone="danger" role="alert" title="Die Testmail ist nicht rausgegangen">
            {refusal}
          </Banner>
        )}
        <div>
          <Button variant="secondary" icon={Send} pending={send.isPending} disabledReason={status.mail_configured ? null : NO_MAIL} onClick={run}>
            Testmail senden
          </Button>
        </div>
        {!status.mail_configured && <p className="max-w-[65ch] text-sm text-pretty text-muted">Trage den Mailserver in der Konfiguration der Instanz ein (MAIL_HOST und die zugehörigen Einstellungen) und starte werkbuch neu. Einladungen lassen sich bis dahin per Link weitergeben.</p>}
      </div>
    </Panel>
  );
}

export default function System(_props: SectionProps) {
  const status = useSystemStatus();
  return (
    <div className="flex flex-col gap-4">
      <SectionHeader title="System" description="Zustand der Instanz: Version, Queue, Suche und Mail. Hier siehst du, ob im Hintergrund etwas hängt." />
      <Loaded queries={[status]} failure="Der Systemzustand konnte nicht geladen werden" skeleton={<FormSkeleton label="Der Systemzustand wird geladen …" />}>
        {() => (
          <>
            <Instance status={status.data!} />
            <FailedJobs status={status.data!} />
            <TestMail status={status.data!} />
          </>
        )}
      </Loaded>
    </div>
  );
}
