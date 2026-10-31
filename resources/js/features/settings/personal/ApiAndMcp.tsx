/*
 * Settings → API & MCP (spec 4.2, 5.2): the person's own tokens, and the snippets that connect an MCP client to the MCP
 * server of this instance. A token is made in the one token dialog (`TokenDialog`, the own account as owner), which shows
 * its plain text once. Revoking runs after five seconds of undo (`useRemoval`). Admins manage the tokens of bots in the
 * organisation settings.
 */

import { KeyRound, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconButton } from '@/components/ui/IconButton';
import { useRevokeToken, useTokens } from '@/hooks/tokens';
import { t } from '@/lib/i18n';
import { instanceOrigin } from '@/lib/links';
import type { Token, User } from '@/types';
import { formatDate } from '../frame/format';
import { RuledList, RuledRow, SettingsCard, SettingsError, SettingsSkeleton } from '../frame/parts';
import { useRemoval } from '../frame/useRemoval';
import { SetupSnippets } from '../tokens/SetupSnippets';
import { TokenDialog } from '../tokens/TokenDialog';

function TokenRow({ token, zone, onRevoke }: { token: Token; zone: string; onRevoke: () => void }) {
  const expired = token.expires_at !== null && new Date(token.expires_at).getTime() <= Date.now();
  const created = formatDate(token.created_at, zone);
  return (
    <RuledRow className="flex flex-wrap items-start gap-x-4 gap-y-2">
      <div className="min-w-0 flex-1 basis-56">
        <h3 className="truncate text-md font-semibold text-ink">{token.name}</h3>
        <ul role="list" aria-label={t('settings.tokens.abilities')} className="mt-1.5 flex flex-wrap gap-1.5">
          {token.abilities.map((ability) => (
            <li key={ability}>
              <Chip>{t(`settings.tokens.ability.${ability}`)}</Chip>
            </li>
          ))}
          {expired && (
            <li>
              <Chip>{t('settings.tokens.expired')}</Chip>
            </li>
          )}
        </ul>
        <p className="mt-1.5 text-sm text-muted tabular-nums">
          {token.last_used_at
            ? t('settings.api.created_used', { created, used: formatDate(token.last_used_at, zone) })
            : t('settings.api.created_unused', { created })}
        </p>
        {token.expires_at && (
          <p className="text-sm text-muted tabular-nums">
            {t(expired ? 'settings.api.expired_on' : 'settings.api.expires_on', { date: formatDate(token.expires_at, zone) })}
          </p>
        )}
      </div>
      <IconButton icon={Trash2} label={t('settings.api.revoke', { name: token.name })} onClick={onRevoke} />
    </RuledRow>
  );
}

export function ApiAndMcp({ user }: { user: User }) {
  const tokens = useTokens(user.id);
  const revoke = useRevokeToken();
  const { hidden, remove } = useRemoval();
  const [creating, setCreating] = useState(false);
  const origin = instanceOrigin();

  const shown = (tokens.data?.items ?? []).filter((token) => !hidden.has(token.id));
  let content;
  if (tokens.isPending) content = <SettingsSkeleton rows={2} label={t('settings.tokens.loading')} />;
  else if (tokens.isError) {
    content = <SettingsError title={t('settings.tokens.load_failed')} error={tokens.error} retrying={tokens.isFetching} onRetry={() => void tokens.refetch()} />;
  } else if (shown.length === 0) {
    content = (
      <EmptyState
        icon={KeyRound}
        title={t('settings.api.empty.title')}
        description={t('settings.api.empty.description')}
        actions={
          <Button variant="primary" icon={KeyRound} onClick={() => setCreating(true)}>
            {t('settings.api.empty.create')}
          </Button>
        }
      />
    );
  } else {
    content = (
      <RuledList label={t('settings.tokens.title')}>
        {shown.map((token) => (
          <TokenRow
            key={token.id}
            token={token}
            zone={user.timezone}
            onRevoke={() =>
              remove({
                id: token.id,
                label: t('settings.api.revoked', { name: token.name }),
                failureTitle: t('settings.tokens.not_revoked', { name: token.name }),
                run: () => revoke.mutateAsync(token.id),
              })
            }
          />
        ))}
      </RuledList>
    );
  }

  return (
    <>
      <SettingsCard
        flush={shown.length > 0 && !tokens.isError}
        title={t('settings.tokens.title')}
        description={t('settings.api.tokens_description')}
        actions={
          <Button variant="secondary" icon={KeyRound} onClick={() => setCreating(true)}>
            {t('settings.api.new_token')}
          </Button>
        }
      >
        {content}
      </SettingsCard>
      <SettingsCard title={t('settings.api.connect.title')} description={t('settings.api.connect.description')}>
        <dl className="grid gap-x-6 gap-y-1 text-ui sm:grid-cols-[auto_minmax(0,1fr)]">
          <dt className="text-muted">{t('settings.api.connect.mcp')}</dt>
          <dd translate="no" className="min-w-0 font-medium [overflow-wrap:anywhere] text-ink">{`${origin}/mcp`}</dd>
          <dt className="text-muted">{t('settings.api.connect.rest')}</dt>
          <dd translate="no" className="min-w-0 font-medium [overflow-wrap:anywhere] text-ink">{`${origin}/api/v1`}</dd>
        </dl>
        <SetupSnippets />
      </SettingsCard>
      {creating && <TokenDialog owner={user} onClose={() => setCreating(false)} />}
    </>
  );
}
