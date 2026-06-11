import { fireEvent, render, screen } from '@testing-library/react';

import { UserMenu } from '@/components/UserMenu';

const push = jest.fn();
const prefetch = jest.fn();
let mockPathname = '/';
let currentUser: {
  username: string;
  role: 'owner' | 'admin' | 'user';
} = { username: 'tester', role: 'user' };

jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ prefetch, push }),
}));

jest.mock('@/lib/auth', () => ({
  getRuntimeCurrentUser: () => currentUser,
}));

describe('UserMenu', () => {
  beforeEach(() => {
    push.mockClear();
    prefetch.mockClear();
    mockPathname = '/';
    currentUser = { username: 'tester', role: 'user' };
    window.RUNTIME_CONFIG = {
      STORAGE_TYPE: 'd1',
      CURRENT_USER: currentUser,
    };
    global.fetch = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue({
        authenticated: true,
        user: currentUser,
      }),
    }) as jest.Mock;
  });

  it('opens an account menu for regular users without settings or TVBox entries', async () => {
    render(<UserMenu />);

    fireEvent.click(screen.getByRole('button', { name: 'User Menu' }));

    expect(await screen.findByText('修改密码')).toBeInTheDocument();
    expect(screen.getByText('退出登录')).toBeInTheDocument();
    expect(screen.queryByText('偏好设置')).not.toBeInTheDocument();
    expect(screen.queryByText('TVBox配置')).not.toBeInTheDocument();
    expect(screen.queryByText('管理面板')).not.toBeInTheDocument();
  });

  it('shows the admin panel entry only for admins', async () => {
    currentUser = { username: 'admin', role: 'admin' };
    window.RUNTIME_CONFIG = {
      STORAGE_TYPE: 'd1',
      CURRENT_USER: currentUser,
    };
    global.fetch = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue({
        authenticated: true,
        user: currentUser,
      }),
    }) as jest.Mock;

    render(<UserMenu />);

    fireEvent.click(screen.getByRole('button', { name: 'User Menu' }));

    expect(await screen.findByText('管理面板')).toBeInTheDocument();
    expect(screen.getByText('修改密码')).toBeInTheDocument();
    expect(screen.queryByText('偏好设置')).not.toBeInTheDocument();
    expect(screen.queryByText('TVBox配置')).not.toBeInTheDocument();
    expect(prefetch).toHaveBeenCalledWith('/admin');
  });

  it('closes the account menu immediately when opening the admin panel', async () => {
    currentUser = { username: 'admin', role: 'admin' };
    window.RUNTIME_CONFIG = {
      STORAGE_TYPE: 'd1',
      CURRENT_USER: currentUser,
    };
    global.fetch = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue({
        authenticated: true,
        user: currentUser,
      }),
    }) as jest.Mock;

    render(<UserMenu />);

    fireEvent.click(screen.getByRole('button', { name: 'User Menu' }));
    fireEvent.click(await screen.findByText('管理面板'));

    expect(push).toHaveBeenCalledWith('/admin');
    expect(screen.queryByText('管理面板')).not.toBeInTheDocument();
  });

  it('closes the account menu when the route changes', async () => {
    currentUser = { username: 'admin', role: 'admin' };
    window.RUNTIME_CONFIG = {
      STORAGE_TYPE: 'd1',
      CURRENT_USER: currentUser,
    };
    global.fetch = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue({
        authenticated: true,
        user: currentUser,
      }),
    }) as jest.Mock;

    const { rerender } = render(<UserMenu />);

    fireEvent.click(screen.getByRole('button', { name: 'User Menu' }));
    expect(await screen.findByText('管理面板')).toBeInTheDocument();

    mockPathname = '/admin';
    rerender(<UserMenu />);

    expect(screen.queryByText('管理面板')).not.toBeInTheDocument();
  });
});
