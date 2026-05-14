import { fireEvent, render, screen } from '@testing-library/react';

import { UserMenu } from '@/components/UserMenu';

const push = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

jest.mock('@/lib/auth', () => ({
  getRuntimeCurrentUser: () => ({ username: 'tester', role: 'user' }),
}));

describe('UserMenu', () => {
  beforeEach(() => {
    push.mockClear();
    global.fetch = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue({
        authenticated: true,
        user: { username: 'tester', role: 'user' },
      }),
    }) as jest.Mock;
  });

  it('opens a grouped menu with preference and logout actions', async () => {
    render(<UserMenu />);

    fireEvent.click(screen.getByRole('button', { name: 'User Menu' }));

    expect(await screen.findAllByText('偏好设置')).not.toHaveLength(0);
    expect(screen.getByText('退出登录')).toBeInTheDocument();
  });
});
