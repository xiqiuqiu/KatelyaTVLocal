import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

import {
  buildRegistrationInviteLink,
  getInviteCodeFromSearchParams,
} from '@/lib/registration/invite-link';

import LoginPage from '@/app/login/page';

let mockSearchParams = new URLSearchParams();
const originalFetch = global.fetch;

jest.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}));

jest.mock('@/components/ThemeToggle', () => ({
  ThemeToggle: () => <button type='button'>Theme</button>,
}));

describe('LoginPage invite link', () => {
  beforeEach(() => {
    mockSearchParams = new URLSearchParams();
    document.getElementById('cf-turnstile-script')?.remove();
    delete window.turnstile;
    window.RUNTIME_CONFIG = {
      STORAGE_TYPE: 'd1',
      ENABLE_REGISTER: true,
      REGISTER_INVITE_REQUIRED: true,
    };
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('reads invite code aliases from browser query params', () => {
    expect(
      getInviteCodeFromSearchParams(new URLSearchParams('inviteCode=INV-1'))
    ).toBe('INV-1');
    expect(
      getInviteCodeFromSearchParams(new URLSearchParams('invite=INV-2'))
    ).toBe('INV-2');
    expect(
      getInviteCodeFromSearchParams(new URLSearchParams('code=INV-3'))
    ).toBe('INV-3');
  });

  it('builds registration invite links from the current deployment origin', () => {
    expect(
      buildRegistrationInviteLink({
        code: ' KATELYA 2026 ',
        origin: 'https://tv.example.com/admin',
      })
    ).toBe('https://tv.example.com/login?inviteCode=KATELYA+2026');
  });

  it('prefills the registration invite input from the URL', async () => {
    mockSearchParams = new URLSearchParams('inviteCode=KATELYA-2026');

    render(<LoginPage />);

    const inviteInput = await screen.findByLabelText('邀请码');

    await waitFor(() => {
      expect(inviteInput).toHaveValue('KATELYA-2026');
    });
  });

  it('keeps invite code and Turnstile fields on the registration tab only', async () => {
    window.RUNTIME_CONFIG = {
      STORAGE_TYPE: 'd1',
      ENABLE_REGISTER: true,
      REGISTER_INVITE_REQUIRED: true,
      TURNSTILE_SITE_KEY: 'site-key',
    };

    render(<LoginPage />);

    await screen.findByRole('button', { name: '登录', pressed: true });

    expect(
      screen.getByRole('heading', { name: '欢迎回来' })
    ).toBeInTheDocument();
    expect(screen.getByLabelText('访问密码')).toHaveAttribute(
      'autocomplete',
      'current-password'
    );
    expect(screen.queryByLabelText('邀请码')).not.toBeInTheDocument();
    expect(document.getElementById('register-turnstile')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '注册' }));

    expect(
      await screen.findByRole('heading', { name: '创建账号' })
    ).toBeInTheDocument();
    expect(screen.getByLabelText('访问密码')).toHaveAttribute(
      'autocomplete',
      'new-password'
    );
    expect(
      screen.getByRole('button', { name: '创建 ReelFind 账号' })
    ).toBeDisabled();
    expect(await screen.findByLabelText('邀请码')).toBeInTheDocument();
    expect(document.getElementById('register-turnstile')).not.toBeNull();
  });

  it('sanitizes unsafe post-login redirect targets', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });
    global.fetch = fetchMock;
    mockSearchParams = new URLSearchParams('redirect=https://evil.com');
    window.RUNTIME_CONFIG = {
      STORAGE_TYPE: 'localstorage',
    };

    const originalLocation = window.location;
    let redirectedTo: string | undefined;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...originalLocation,
        origin: 'http://localhost',
        protocol: 'http:',
        host: 'localhost',
        hostname: 'localhost',
        get href() {
          return redirectedTo ?? 'http://localhost/';
        },
        set href(value: string) {
          redirectedTo = value;
        },
      },
    });

    try {
      render(<LoginPage />);

      fireEvent.change(await screen.findByLabelText('访问密码'), {
        target: { value: 'password123' },
      });
      fireEvent.click(screen.getByRole('button', { name: '进入 ReelFind' }));

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalled();
      });
      expect(redirectedTo).toBe('/');
    } finally {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: originalLocation,
      });
    }
  });

  it('sends the login Turnstile token when login verification is required', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: '请先完成人机验证' }),
    });
    global.fetch = fetchMock;
    window.RUNTIME_CONFIG = {
      STORAGE_TYPE: 'd1',
      TURNSTILE_SITE_KEY: 'site-key',
      LOGIN_TURNSTILE_REQUIRED: true,
    };
    window.turnstile = {
      render: jest.fn((_container, options) => {
        options.callback('login-token');
        return 'widget-id';
      }),
      reset: jest.fn(),
    };

    render(<LoginPage />);

    const script = await waitFor(() => {
      const element = document.getElementById('cf-turnstile-script');
      expect(element).not.toBeNull();
      return element;
    });
    act(() => {
      script?.dispatchEvent(new Event('load'));
    });

    fireEvent.change(await screen.findByLabelText('用户名'), {
      target: { value: 'alice' },
    });
    fireEvent.change(screen.getByLabelText('访问密码'), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByRole('button', { name: '进入 ReelFind' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      username: 'alice',
      password: 'password123',
      turnstileToken: 'login-token',
    });
  });
});
