import { NextRequest } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';

export async function isAdminRequest(request: NextRequest): Promise<boolean> {
  const authInfo = await getAuthInfoFromCookie(request);
  if (!authInfo?.username) {
    return false;
  }

  if (authInfo.username === process.env.USERNAME) {
    return true;
  }

  const config = await getConfig();
  const user = config.UserConfig.Users.find(
    (entry) => entry.username === authInfo.username
  );

  return user?.role === 'admin';
}
