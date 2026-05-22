import { getAuthInfoFromCookie } from '@/lib/auth';
import {
  createRegistrationInvite,
  disableRegistrationInvite,
  listRegistrationInvites,
} from '@/lib/registration/invite-admin';

class MockResponse {
  status: number;
  headers: Record<string, string>;

  constructor(
    private readonly payload: unknown,
    init?: { status?: number; headers?: Record<string, string> }
  ) {
    this.status = init?.status ?? 200;
    this.headers = init?.headers || {};
  }

  async json(): Promise<unknown> {
    return this.payload;
  }
}

let GET: (request: { url: string }) => Promise<MockResponse>;
let POST: (
  request: { url: string; json: () => Promise<unknown> }
) => Promise<MockResponse>;

jest.mock('next/server', () => ({
  NextResponse: {
    json: (
      payload: unknown,
      init?: { status?: number; headers?: Record<string, string> }
    ) => new MockResponse(payload, init),
  },
}));

jest.mock('@/lib/auth', () => ({
  getAuthInfoFromCookie: jest.fn(),
}));

jest.mock('@/lib/config', () => ({
  getConfig: jest.fn(),
}));

jest.mock('@/lib/registration/invite-admin', () => ({
  createRegistrationInvite: jest.fn(),
  disableRegistrationInvite: jest.fn(),
  listRegistrationInvites: jest.fn(),
}));

describe('admin registration invites route', () => {
  const mockedGetAuthInfoFromCookie =
    getAuthInfoFromCookie as jest.MockedFunction<typeof getAuthInfoFromCookie>;
  const mockedCreateRegistrationInvite =
    createRegistrationInvite as jest.MockedFunction<
      typeof createRegistrationInvite
    >;
  const mockedDisableRegistrationInvite =
    disableRegistrationInvite as jest.MockedFunction<
      typeof disableRegistrationInvite
    >;
  const mockedListRegistrationInvites =
    listRegistrationInvites as jest.MockedFunction<
      typeof listRegistrationInvites
    >;

  beforeAll(() => {
    process.env.NEXT_PUBLIC_STORAGE_TYPE = 'd1';
    process.env.USERNAME = 'owner';
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ({ GET, POST } = require('@/app/api/admin/registration-invites/route'));
  });

  beforeEach(() => {
    mockedGetAuthInfoFromCookie.mockResolvedValue({
      version: 2,
      username: 'owner',
      role: 'owner',
      issuedAt: 1,
    });
    mockedListRegistrationInvites.mockResolvedValue([]);
    mockedCreateRegistrationInvite.mockResolvedValue({
      code: 'INVITE',
      maxUses: 1,
      usedCount: 0,
      disabled: false,
      expiresAt: null,
      createdAt: 1,
      updatedAt: 1,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('rejects unauthenticated requests', async () => {
    mockedGetAuthInfoFromCookie.mockResolvedValue(null);

    const response = await GET({
      url: 'https://app.example.com/api/admin/registration-invites',
    });

    expect(response.status).toBe(401);
    expect(mockedListRegistrationInvites).not.toHaveBeenCalled();
  });

  it('creates invites for owner', async () => {
    const response = await POST({
      url: 'https://app.example.com/api/admin/registration-invites',
      json: async () => ({ action: 'create', maxUses: 3 }),
    });

    expect(response.status).toBe(200);
    expect(mockedCreateRegistrationInvite).toHaveBeenCalledWith({
      maxUses: 3,
      expiresAt: undefined,
    });
    await expect(response.json()).resolves.toMatchObject({
      invite: { code: 'INVITE' },
    });
  });

  it('disables invites for owner', async () => {
    const response = await POST({
      url: 'https://app.example.com/api/admin/registration-invites',
      json: async () => ({ action: 'disable', code: 'INVITE' }),
    });

    expect(response.status).toBe(200);
    expect(mockedDisableRegistrationInvite).toHaveBeenCalledWith({
      code: 'INVITE',
    });
  });
});
