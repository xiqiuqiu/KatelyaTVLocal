import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import {
  buildRegistrationInviteLink,
  getInviteCodeFromSearchParams,
} from '@/lib/registration/invite-link';

import LoginPage from '@/app/login/page';

let mockSearchParams = new URLSearchParams();

jest.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}));

jest.mock('@/components/ThemeToggle', () => ({
  ThemeToggle: () => <button type='button'>Theme</button>,
}));

describe('LoginPage invite link', () => {
  beforeEach(() => {
    mockSearchParams = new URLSearchParams();
    window.RUNTIME_CONFIG = {
      STORAGE_TYPE: 'd1',
      ENABLE_REGISTER: true,
      REGISTER_INVITE_REQUIRED: true,
    };
  });

  afterEach(() => {
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

    expect(screen.queryByLabelText('邀请码')).not.toBeInTheDocument();
    expect(document.getElementById('register-turnstile')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '注册' }));

    expect(await screen.findByLabelText('邀请码')).toBeInTheDocument();
    expect(document.getElementById('register-turnstile')).not.toBeNull();
  });
});
