const INVITE_CODE_SEARCH_PARAM_NAMES = ['inviteCode', 'invite', 'code'];
const REGISTER_PAGE_PATH = '/login';

export function buildRegistrationInviteLink({
  code,
  origin,
}: {
  code: string;
  origin: string;
}) {
  const url = new URL(REGISTER_PAGE_PATH, origin);
  url.searchParams.set('inviteCode', code.trim());

  return url.toString();
}

export function getInviteCodeFromSearchParams(
  searchParams: Pick<URLSearchParams, 'get'>
) {
  for (const name of INVITE_CODE_SEARCH_PARAM_NAMES) {
    const value = searchParams.get(name)?.trim();
    if (value) {
      return value;
    }
  }

  return '';
}
