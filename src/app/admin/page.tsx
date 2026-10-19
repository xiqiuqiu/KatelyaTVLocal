import { redirect } from 'next/navigation';

import { buildTvModeHref, isTvMode } from '@/lib/tv-interaction';
import { managementSettingsGroups } from '@/lib/ui/settings';

export const runtime = 'edge';

export default function AdminPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const section =
    managementSettingsGroups
      .flatMap((group) => [...group.items])
      .find((item) => item.id === searchParams.section)?.id || 'siteConfig';
  const params = new URLSearchParams();
  if (typeof searchParams.tv === 'string') params.set('tv', searchParams.tv);
  return redirect(buildTvModeHref(`/?settings=${section}`, isTvMode(params)));
}
