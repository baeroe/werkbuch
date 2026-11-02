/*
 * Created and changed: the day of the timestamp in the organisation's time zone (as the rows and the filters count it),
 * in the language of the page. Only shown; Enter says why (TableLayout).
 */

import { formatDay } from '@/components/fields/format';
import { cachedZone } from '@/domain/tz';
import { useOrganization } from '@/hooks/organization';

export function StampCell({ value }: { value: string }) {
  const zone = cachedZone(useOrganization().data.timezone);
  return <span className="truncate px-1 tabular-nums">{formatDay(zone.date(new Date(value)))}</span>;
}
