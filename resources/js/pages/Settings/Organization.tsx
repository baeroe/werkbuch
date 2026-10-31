import { OrgSettings } from '@/features/settings/org/OrgSettings';
import { shellLayout } from '@/shell/layout';

/** `/settings/{section?}`: the settings of the organisation, the section from the address (`general` by default). */
export default function Organization({ section }: { section: string }) {
  return <OrgSettings section={section} />;
}

Organization.layout = shellLayout;
