import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { ReactNode } from 'react';
import Swal from 'sweetalert2';

import { AdminConfig } from '@/lib/admin.types';
import { managementSettingsGroups } from '@/lib/ui/settings';

import AdminPage from './page';

let mockSearchParams = new URLSearchParams();
let mockRole: 'owner' | 'admin' = 'admin';

jest.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}));

jest.mock('@/components/PageLayout', () => ({
  __esModule: true,
  default: ({
    children,
    tvMode,
    modeHref,
  }: {
    children: ReactNode;
    tvMode: boolean;
    modeHref: string;
  }) => (
    <main data-tv-mode={tvMode} data-mode-href={modeHref}>
      {children}
    </main>
  ),
}));

jest.mock('@/lib/auth', () => ({
  getRuntimeCurrentUser: () => ({ username: 'admin-self', role: mockRole }),
}));

jest.mock('sweetalert2', () => ({
  __esModule: true,
  default: { fire: jest.fn().mockResolvedValue({ isConfirmed: false }) },
}));

const config: AdminConfig = {
  SiteConfig: {
    SiteName: '测试站点',
    Announcement: '',
    SearchDownstreamMaxPage: 2,
    SiteInterfaceCacheTime: 600,
    ImageProxy: '',
    DoubanProxy: '',
  },
  UserConfig: {
    AllowRegister: false,
    Users: [
      { username: 'site-owner', role: 'owner' },
      { username: 'admin-self', role: 'admin' },
      { username: 'admin-other', role: 'admin' },
      { username: 'viewer', role: 'user' },
    ],
  },
  SourceConfig: [
    { key: 'a', name: '来源甲', api: 'https://a.example/api', from: 'custom' },
    { key: 'b', name: '来源乙', api: 'https://b.example/api', from: 'custom' },
  ],
};

beforeEach(() => {
  mockSearchParams = new URLSearchParams('tv=1');
  mockRole = 'admin';
  window.RUNTIME_CONFIG = { STORAGE_TYPE: 'localstorage' };
  jest.clearAllMocks();
  global.fetch = jest.fn().mockImplementation(async () => ({
    ok: true,
    json: async () => ({ Config: config, Role: mockRole }),
  }));
});

afterEach(() => jest.restoreAllMocks());

it('reorders sources with buttons and keeps the original explicit save contract', async () => {
  const consoleError = jest.spyOn(console, 'error');
  render(<AdminPage />);
  fireEvent.click(await screen.findByRole('button', { name: '视频源配置' }));

  expect(screen.getByRole('main')).toHaveAttribute('data-tv-mode', 'true');
  expect(screen.getByRole('main')).toHaveAttribute('data-mode-href', '/admin');
  expect(screen.getByRole('button', { name: '上移 来源甲' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '下移 来源乙' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '下移 来源甲' }));

  const table = screen.getByRole('table');
  const rows = within(table).getAllByRole('row');
  expect(rows[1]).toHaveTextContent('来源乙');
  expect(rows[2]).toHaveTextContent('来源甲');
  expect(fetch).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: '保存排序' }));
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith('/api/admin/source', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'sort', order: ['b', 'a'] }),
    })
  );
  expect(
    consoleError.mock.calls.filter(([message]) =>
      String(message).includes('validateDOMNesting')
    )
  ).toEqual([]);
});

it('keeps owner and peer administrator operations hidden from an administrator', async () => {
  render(<AdminPage />);
  fireEvent.click(await screen.findByRole('button', { name: '用户配置' }));

  expect(
    screen.queryByRole('button', { name: '重置配置' })
  ).not.toBeInTheDocument();
  const ownerRow = screen.getByText('site-owner').closest('tr');
  const peerRow = screen.getByText('admin-other').closest('tr');
  const viewerRow = screen.getByText('viewer').closest('tr');
  expect(ownerRow).not.toBeNull();
  expect(peerRow).not.toBeNull();
  expect(viewerRow).not.toBeNull();
  if (!ownerRow || !peerRow || !viewerRow) throw new Error('用户行未渲染');
  expect(within(ownerRow).queryAllByRole('button')).toHaveLength(0);
  expect(within(peerRow).queryAllByRole('button')).toHaveLength(0);
  expect(
    within(viewerRow).getByRole('button', { name: '删除用户' })
  ).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('cancels a destructive reset without sending a mutation request', async () => {
  mockRole = 'owner';
  render(<AdminPage />);
  fireEvent.click(await screen.findByRole('button', { name: '重置配置' }));
  await waitFor(() =>
    expect(Swal.fire).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '确认重置配置',
        focusCancel: true,
        showCancelButton: true,
      })
    )
  );
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('shows a retryable error without rendering administration controls after a rejected config request', async () => {
  (fetch as jest.Mock).mockResolvedValueOnce({
    ok: false,
    json: async () => ({ error: '无权限' }),
  });
  render(<AdminPage />);
  expect(await screen.findByRole('alert')).toHaveTextContent('无权限');
  expect(
    screen.queryByRole('navigation', { name: '管理分类' })
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
  expect(
    await screen.findByRole('navigation', { name: '管理分类' })
  ).toBeInTheDocument();
});

it('associates visible site and registration labels with their actual controls', async () => {
  render(<AdminPage />);
  fireEvent.click(await screen.findByRole('button', { name: '站点配置' }));
  fireEvent.click(screen.getByRole('button', { name: '用户配置' }));

  for (const id of [
    'admin-allow-register',
    'admin-site-name',
    'admin-site-announcement',
    'admin-search-max-pages',
    'admin-site-cache-time',
    'admin-image-proxy',
    'admin-douban-proxy',
    'admin-playback-debug',
  ]) {
    const label = document.querySelector<HTMLLabelElement>(
      `label[for="${id}"]`
    );
    expect(label).not.toBeNull();
    expect(label?.control).toBe(document.getElementById(id));
  }
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('organizes all six existing panels into the same navigation and content groups', async () => {
  render(<AdminPage />);
  const navigation = await screen.findByRole('navigation', {
    name: '管理分类',
  });
  const labels = managementSettingsGroups.flatMap((group) =>
    group.items.map((item) => item.label)
  );

  expect(
    within(navigation)
      .getAllByRole('link')
      .map((link) => link.textContent)
  ).toEqual(labels);
  for (const group of managementSettingsGroups) {
    const content = screen.getByRole('region', { name: group.label });
    for (const item of group.items) {
      expect(
        within(navigation).getByRole('link', { name: item.label })
      ).toHaveAttribute('href', `#admin-${item.id}`);
      expect(
        within(content).getByRole('button', { name: item.label })
      ).toHaveAttribute('aria-expanded', 'false');
    }
  }
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('opens an allowed deep link and preserves an unsaved form when the query selects another section', async () => {
  mockSearchParams = new URLSearchParams('tv=1&section=siteConfig');
  const { rerender } = render(<AdminPage />);
  const siteName = await screen.findByLabelText('站点名称');
  fireEvent.change(siteName, { target: { value: '未保存站点名称' } });
  expect(screen.getByRole('main')).toHaveAttribute(
    'data-mode-href',
    '/admin?section=siteConfig'
  );

  mockSearchParams = new URLSearchParams('tv=1&section=videoSource');
  rerender(<AdminPage />);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '视频源配置' })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
  );
  expect(screen.getByLabelText('站点名称')).toBe(siteName);
  expect(siteName).toHaveValue('未保存站点名称');
  expect(screen.getByRole('button', { name: '站点配置' })).toHaveAttribute(
    'aria-expanded',
    'true'
  );
  expect(screen.getByRole('main')).toHaveAttribute(
    'data-mode-href',
    '/admin?section=videoSource'
  );
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('ignores unknown section values without mounting any administration form', async () => {
  mockSearchParams = new URLSearchParams('tv=1&section=unknown');
  render(<AdminPage />);
  await screen.findByRole('navigation', { name: '管理分类' });

  for (const group of managementSettingsGroups) {
    for (const item of group.items) {
      expect(screen.getByRole('button', { name: item.label })).toHaveAttribute(
        'aria-expanded',
        'false'
      );
    }
  }
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(screen.getByRole('main')).toHaveAttribute('data-mode-href', '/admin');
  expect(fetch).toHaveBeenCalledTimes(1);
});
