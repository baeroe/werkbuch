/*
 * The profile menu at the bottom of the sidebar: theme, personal settings and sign-out. Signing out with unsent text
 * (a comment, a description not saved yet: `lib/drafts.ts`) asks first: it goes with the person (`resetForUser`), and
 * signing out is a visit of the page, which the browser's own question on leaving does not cover.
 */

import { Link, router } from '@inertiajs/react';
import { LogOut, UserRound } from 'lucide-react';
import { useRef, useState } from 'react';
import { AlertDialog } from '@/components/ui/AlertDialog';
import { Avatar } from '@/components/ui/Avatar';
import { Menu, MenuContent, MenuGroup, MenuGroupLabel, MenuLinkItem, MenuItem, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger } from '@/components/ui/Menu';
import { toast } from '@/components/ui/toast';
import { drafts } from '@/lib/drafts';
import { t, type TranslationKey } from '@/lib/i18n';
import { paths } from '@/lib/links';
import { useSharedProps } from '@/lib/page';
import type { ThemeChoice } from '@/lib/theme';
import { useUiStore } from '@/store/ui';

const THEMES: { value: ThemeChoice; label: TranslationKey }[] = [
  { value: 'system', label: 'theme.system' },
  { value: 'light', label: 'theme.light' },
  { value: 'dark', label: 'theme.dark' },
];

/** Signs out; whatever goes wrong shows as a toast with its cause, the page stays. */
function logout(): void {
  const failed = (description: string) => {
    toast({ title: t('shell.profile.logout_failed'), description, tone: 'error' });
    // the toast says it; Inertia's own error dialog for the response would say it twice
    return false;
  };
  router.post(
    paths.logout(),
    {},
    {
      onHttpException: (response) => failed(t('errors.http_status', { status: response.status })),
      onNetworkError: () => failed(t('errors.no_answer')),
    },
  );
}

export function ProfileMenu({ compact = false }: { compact?: boolean }) {
  // the shell only renders for signed-in people
  const me = useSharedProps().auth.user!;
  const theme = useUiStore((state) => state.theme);
  const setTheme = useUiStore((state) => state.setTheme);
  const [asking, setAsking] = useState(false);
  /** Where the focus goes back when the question closes: the menu item that asked is gone. */
  const opener = useRef<HTMLButtonElement>(null);

  const trigger = compact ? (
    <button
      ref={opener}
      type="button"
      aria-label={t('shell.profile.label_named', { name: me.name })}
      className="inline-flex size-9 cursor-pointer items-center justify-center rounded-ctl transition-colors duration-120 hover:bg-hover data-popup-open:bg-hover"
    >
      <Avatar user={me} decorative />
    </button>
  ) : (
    <button
      ref={opener}
      type="button"
      className="flex h-11 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-ctl px-2 text-left text-ui transition-colors duration-120 hover:bg-hover data-popup-open:bg-hover md:h-9"
    >
      <Avatar user={me} decorative />
      <span className="min-w-0 flex-1 truncate font-medium text-ink">{me.name}</span>
    </button>
  );

  return (
    <>
      <Menu>
        <MenuTrigger render={trigger} />
        <MenuContent side={compact ? 'right' : 'top'} align={compact ? 'end' : 'start'} className="w-64">
          <MenuGroup>
            <MenuGroupLabel>{t('shell.profile.theme')}</MenuGroupLabel>
            <MenuRadioGroup value={theme} onValueChange={(value) => setTheme(value as ThemeChoice)}>
              {THEMES.map(({ value, label }) => (
                <MenuRadioItem key={value} value={value}>
                  {t(label)}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuGroup>
          <MenuSeparator />
          <MenuLinkItem icon={UserRound} render={<Link href={paths.me()} />}>
            {t('shell.profile.settings')}
          </MenuLinkItem>
          <MenuItem icon={LogOut} onClick={() => (drafts.pending().length > 0 ? setAsking(true) : logout())}>
            {t('shell.profile.logout')}
          </MenuItem>
        </MenuContent>
      </Menu>
      <AlertDialog
        open={asking}
        onOpenChange={setAsking}
        title={t('shell.profile.unsent.title')}
        description={t('shell.profile.unsent.description')}
        confirmLabel={t('shell.profile.unsent.confirm')}
        cancelLabel={t('shell.profile.unsent.cancel')}
        finalFocus={opener}
        onConfirm={() => {
          setAsking(false);
          logout();
        }}
      />
    </>
  );
}
