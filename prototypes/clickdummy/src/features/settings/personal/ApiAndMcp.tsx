/*
 * Settings → API & MCP (spec 4.2, 5.2): the person's own tokens, and the snippets that connect an agent to the MCP
 * server. A token is made in a dialog that shows its plain text once. Revoking runs after five seconds of undo.
 * Admins manage the tokens of bots in the organisation settings.
 */

import { KeyRound, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconButton } from '@/components/ui/IconButton';
import { useRevokeToken, useTokens } from '@/hooks/tokens';
import { now } from '@/lib/clock';
import { instanceOrigin } from '@/lib/links';
import { runWithUndo } from '@/lib/undo';
import type { Token, TokenAbility } from '@/types';
import { focusNeighbour } from '../project/form';
import { RuledList, RuledRow, SettingsCard, SettingsError, SettingsSkeleton } from '../project/SettingsParts';
import type { SectionProps } from './sectionProps';
import { SetupSnippets } from './SetupSnippets';
import { TokenDialog } from './TokenDialog';

const ABILITY_LABEL: Record<TokenAbility, string> = { read: 'Lesen', write: 'Schreiben', mcp: 'MCP' };

const without = <T,>(set: ReadonlySet<T>, value: T): Set<T> => new Set([...set].filter((entry) => entry !== value));

export function ApiAndMcp({ user }: SectionProps) {
  const tokens = useTokens(user.id);
  const revoke = useRevokeToken();
  const [creating, setCreating] = useState(false);
  // revoked, and waiting for the end of the undo time: the row is gone from the screen already
  const [revoking, setRevoking] = useState<ReadonlySet<string>>(new Set());

  const day = (iso: string) => new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: user.timezone }).format(new Date(iso));
  const origin = instanceOrigin();

  function revokeWithUndo(token: Token, row: Element | null) {
    focusNeighbour(row);
    setRevoking((current) => new Set(current).add(token.id));
    const show = () => setRevoking((current) => without(current, token.id));
    runWithUndo({
      label: `Token „${token.name}“ widerrufen`,
      run: async () => {
        try {
          await revoke.mutateAsync(token.id);
        } finally {
          show();
        }
      },
      undo: show,
    });
  }

  const shown = (tokens.data?.items ?? []).filter((token) => !revoking.has(token.id));
  let content;
  if (tokens.isPending) content = <SettingsSkeleton rows={2} label="Tokens werden geladen …" />;
  else if (tokens.isError) {
    content = <SettingsError title="Die Tokens konnten nicht geladen werden" error={tokens.error} retrying={tokens.isFetching} onRetry={() => void tokens.refetch()} />;
  } else if (shown.length === 0) {
    content = (
      <EmptyState
        icon={KeyRound}
        title="Noch keine Tokens"
        description="Leg einen an, um einen Agenten oder ein Skript zu verbinden."
        actions={
          <Button variant="primary" icon={KeyRound} onClick={() => setCreating(true)}>
            Ersten Token anlegen
          </Button>
        }
      />
    );
  } else {
    content = (
      <RuledList label="Tokens">
        {shown.map((token) => {
          const expired = token.expires_at !== null && token.expires_at <= now().toISOString();
          return (
            <RuledRow key={token.id} className="flex flex-wrap items-start gap-x-4 gap-y-2">
              <div className="min-w-0 flex-1 basis-56">
                <h3 className="truncate text-md font-semibold text-ink">{token.name}</h3>
                <ul role="list" className="mt-1.5 flex flex-wrap gap-1.5">
                  {token.abilities.map((ability) => (
                    <li key={ability}>
                      <Chip>{ABILITY_LABEL[ability]}</Chip>
                    </li>
                  ))}
                  {expired && (
                    <li>
                      <Chip>Abgelaufen</Chip>
                    </li>
                  )}
                </ul>
                <p className="mt-1.5 text-sm text-muted tabular-nums">
                  {`Angelegt am ${day(token.created_at)}, ${token.last_used_at ? `zuletzt benutzt am ${day(token.last_used_at)}` : 'noch nie benutzt'}`}
                </p>
                {token.expires_at && <p className="text-sm text-muted tabular-nums">{`${expired ? 'Abgelaufen' : 'Läuft ab'} am ${day(token.expires_at)}`}</p>}
              </div>
              <IconButton icon={Trash2} label={`${token.name} widerrufen`} onClick={(event) => revokeWithUndo(token, event.currentTarget.closest('li'))} />
            </RuledRow>
          );
        })}
      </RuledList>
    );
  }

  return (
    <>
      <SettingsCard
        flush={shown.length > 0 && !tokens.isError}
        title="Tokens"
        description="Mit einem Token handeln Agenten und Skripte in deinem Namen, mit den Rechten deines Kontos. Leg einen pro Gerät oder Skript an, dann kannst du sie einzeln widerrufen."
        actions={
          <Button variant="secondary" icon={KeyRound} onClick={() => setCreating(true)}>
            Neuer Token
          </Button>
        }
      >
        {content}
      </SettingsCard>
      <SettingsCard title="Agent verbinden" description="Trag den MCP-Server mit einem Token mit der Fähigkeit MCP in deinem Agenten ein.">
        <dl className="grid gap-x-6 gap-y-1 text-ui sm:grid-cols-[auto_minmax(0,1fr)]">
          <dt className="text-muted">MCP-Server</dt>
          <dd translate="no" className="min-w-0 font-medium [overflow-wrap:anywhere] text-ink">{`${origin}/mcp`}</dd>
          <dt className="text-muted">REST-API</dt>
          <dd translate="no" className="min-w-0 font-medium [overflow-wrap:anywhere] text-ink">{`${origin}/api/v1`}</dd>
        </dl>
        <SetupSnippets />
      </SettingsCard>
      {creating && <TokenDialog user={user} onClose={() => setCreating(false)} />}
    </>
  );
}
