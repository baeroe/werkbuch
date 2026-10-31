import { PersonalSettings } from '@/features/settings/personal/PersonalSettings';
import { shellLayout } from '@/shell/layout';

/** `/me/{section?}`: the own settings, the section from the address (the profile without one). */
export default function Personal({ section }: { section: string }) {
  return <PersonalSettings section={section} />;
}

Personal.layout = shellLayout;
