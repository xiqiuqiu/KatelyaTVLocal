import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { useRef } from 'react';

import { UserMenu } from '@/components/UserMenu';
import useTvBrowseNavigation from '@/components/useTvBrowseNavigation';

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

  it.each([false, true])(
    'closes the account menu and preserves TV mode when opening admin (%s)',
    async (tvMode) => {
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

      render(<UserMenu tvMode={tvMode} />);

      fireEvent.click(screen.getByRole('button', { name: 'User Menu' }));
      fireEvent.click(await screen.findByText('管理面板'));

      expect(push).toHaveBeenCalledWith(tvMode ? '/admin?tv=1' : '/admin');
      await waitFor(() => {
        expect(screen.queryByText('管理面板')).not.toBeInTheDocument();
      });
    }
  );

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

    await waitFor(() => {
      expect(screen.queryByText('管理面板')).not.toBeInTheDocument();
    });
  });

  it('closes the account menu when pressing Escape', async () => {
    render(<UserMenu />);

    fireEvent.click(screen.getByRole('button', { name: 'User Menu' }));
    expect(await screen.findByText('修改密码')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByText('修改密码')).not.toBeInTheDocument();
    });
  });

  it('closes the account menu when clicking the dismiss overlay', async () => {
    render(<UserMenu />);

    fireEvent.click(screen.getByRole('button', { name: 'User Menu' }));
    expect(await screen.findByText('修改密码')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '关闭菜单' }));

    await waitFor(() => {
      expect(screen.queryByText('修改密码')).not.toBeInTheDocument();
    });
  });

  it('closes the change password panel when pressing Escape', async () => {
    render(<UserMenu />);

    fireEvent.click(screen.getByRole('button', { name: 'User Menu' }));
    fireEvent.click(screen.getByRole('button', { name: '账号与安全' }));
    fireEvent.click(await screen.findByText('修改密码'));
    expect(await screen.findByText('确认修改')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByText('确认修改')).not.toBeInTheDocument();
  });

  it('exposes personal navigation without granting admin access and traps menu focus', async () => {
    render(<UserMenu tvMode modeHref='/search?q=test&tv=1' />);
    const trigger = screen.getByRole('button', { name: 'User Menu' });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: '设置与账号' });
    fireEvent.click(within(dialog).getByRole('button', { name: '观看与收藏' }));
    expect(
      within(dialog).getByRole('link', { name: '我的收藏' })
    ).toHaveAttribute('href', '/?tab=favorites&tv=1');
    expect(
      within(dialog).getByRole('link', { name: '播放历史' })
    ).toHaveAttribute('href', '/history?tv=1');
    fireEvent.click(within(dialog).getByRole('button', { name: '外观与设备' }));
    expect(
      within(dialog).getByRole('link', { name: '退出电视模式' })
    ).toHaveAttribute('href', '/search?q=test&tv=0');
    expect(within(dialog).queryByText('管理面板')).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: '账号与安全' }));
    const last = within(dialog).getByRole('button', { name: '退出登录' });
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(
      within(dialog).getByRole('button', { name: '关闭设置与账号' })
    ).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    );
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('shows only the selected settings category and keeps its menu visible', async () => {
    render(<UserMenu />);
    fireEvent.click(screen.getByRole('button', { name: 'User Menu' }));
    const dialog = await screen.findByRole('dialog', { name: '设置与账号' });
    expect(
      within(dialog).getByRole('region', { name: '外观与设备' })
    ).toBeVisible();
    expect(
      within(dialog).queryByRole('region', { name: '账号与安全' })
    ).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: '账号与安全' }));
    expect(
      within(dialog).getByRole('region', { name: '账号与安全' })
    ).toHaveTextContent('tester');
    expect(
      within(dialog).queryByRole('region', { name: '外观与设备' })
    ).not.toBeInTheDocument();
    expect(within(dialog).getAllByRole('region')).toHaveLength(1);
    expect(
      within(dialog).getByRole('button', { name: '账号与安全' })
    ).toHaveAttribute('aria-pressed', 'true');
  });

  it.each([
    ['user', false],
    ['admin', false],
    ['owner', false],
    ['user', true],
    ['admin', true],
    ['owner', true],
  ] as const)(
    'keeps management groups permission-gated and links to the chosen section (%s, TV=%s)',
    async (role, tvMode) => {
      currentUser = { username: role, role };
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
      render(<UserMenu tvMode={tvMode} />);
      fireEvent.click(screen.getByRole('button', { name: 'User Menu' }));
      const dialog = await screen.findByRole('dialog', { name: '设置与账号' });
      const management = within(dialog).queryByRole('region', {
        name: '站点管理',
      });
      if (role === 'user') {
        expect(management).not.toBeInTheDocument();
        expect(
          within(dialog).queryByRole('link', { name: '站点配置' })
        ).not.toBeInTheDocument();
        return;
      }
      fireEvent.click(within(dialog).getByRole('button', { name: '站点管理' }));
      const managementRegion = await within(dialog).findByRole('region', {
        name: '站点管理',
      });
      expect(managementRegion).toBeInTheDocument();
      expect(
        within(managementRegion).getByRole('button', { name: '管理面板' })
      ).toBeInTheDocument();
      expect(
        document.getElementById('user-settings-account')
      ).not.toContainElement(management);
      for (const [id, label] of [
        ['siteConfig', '站点配置'],
        ['videoSource', '视频源配置'],
        ['userConfig', '用户配置'],
        ['inviteConfig', '注册邀请码'],
        ['aiUsage', 'AI 用量监控'],
        ['playbackDebug', '播放调试日志'],
      ]) {
        expect(
          within(managementRegion).getByRole('link', { name: label })
        ).toHaveAttribute(
          'href',
          `/admin?section=${id}${tvMode ? '&tv=1' : ''}#admin-${id}`
        );
      }
      const destination = within(managementRegion).getByRole('link', {
        name: '站点配置',
      });
      destination.addEventListener('click', (event) => event.preventDefault(), {
        once: true,
      });
      fireEvent.click(destination);
      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      );
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenCalledWith('/api/session');
    }
  );

  it('keeps keyboard focus inside the password dialog', async () => {
    render(<UserMenu />);
    fireEvent.click(screen.getByRole('button', { name: 'User Menu' }));
    fireEvent.click(screen.getByRole('button', { name: '账号与安全' }));
    fireEvent.click(await screen.findByText('修改密码'));
    const dialog = await screen.findByRole('dialog', { name: '修改密码' });
    fireEvent.change(within(dialog).getByLabelText('新密码'), {
      target: { value: 'new-password' },
    });
    fireEvent.change(within(dialog).getByLabelText('确认密码'), {
      target: { value: 'new-password' },
    });
    const close = within(dialog).getByRole('button', { name: '关闭修改密码' });
    const confirm = within(dialog).getByRole('button', { name: '确认修改' });
    confirm.focus();
    fireEvent.keyDown(confirm, { key: 'Tab' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(confirm).toHaveFocus();
    expect(global.fetch).not.toHaveBeenCalledWith(
      '/api/change-password',
      expect.anything()
    );
  });

  it('lets a TV remote enter both password fields and return without submitting', async () => {
    const originalScroll = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = jest.fn();
    const bounds = jest
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        const top =
          this.id === 'user-menu-new-password'
            ? 100
            : this.id === 'user-menu-confirm-password'
            ? 200
            : this.id === 'user-menu-password-cancel'
            ? 300
            : 0;
        return {
          x: 0,
          y: top,
          left: 0,
          top,
          right: 200,
          bottom: top + 50,
          width: 200,
          height: 50,
          toJSON: () => ({}),
        };
      });
    function TvAccount() {
      const root = useRef<HTMLDivElement>(null);
      useTvBrowseNavigation(root, true, '/');
      return (
        <div ref={root}>
          <UserMenu tvMode />
        </div>
      );
    }
    const view = render(<TvAccount />);
    try {
      fireEvent.click(screen.getByRole('button', { name: 'User Menu' }));
      fireEvent.click(screen.getByRole('button', { name: '账号与安全' }));
      fireEvent.click(await screen.findByText('修改密码'));
      const dialog = await screen.findByRole('dialog', { name: '修改密码' });
      await waitFor(() =>
        expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
      );
      const first = within(dialog).getByLabelText('新密码');
      const second = within(dialog).getByLabelText('确认密码');
      within(dialog).getByRole('button', { name: '关闭修改密码' }).focus();
      fireEvent.keyDown(document.activeElement || document.body, {
        key: 'ArrowDown',
      });
      expect(first).toHaveFocus();
      fireEvent.keyDown(first, { key: 'Enter' });
      expect(first).not.toHaveAttribute('readonly');
      fireEvent.keyDown(first, { key: 'ArrowDown' });
      expect(second).toHaveFocus();
      fireEvent.keyDown(second, { key: 'Enter' });
      expect(second).not.toHaveAttribute('readonly');
      fireEvent.keyDown(second, { key: 'BrowserBack' });
      expect(second).toHaveAttribute('readonly');
      expect(dialog).toBeInTheDocument();
      fireEvent.keyDown(second, { key: 'BrowserBack', keyCode: 4 });
      expect(
        screen.queryByRole('dialog', { name: '修改密码' })
      ).not.toBeInTheDocument();
      expect(global.fetch).not.toHaveBeenCalledWith(
        '/api/change-password',
        expect.anything()
      );
    } finally {
      view.unmount();
      bounds.mockRestore();
      HTMLElement.prototype.scrollIntoView = originalScroll;
    }
  });
});
