import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import Swal from 'sweetalert2';

import { AdminConfig } from '@/lib/admin.types';

import { AdminSettings } from './AdminSettings';
let mockRole: 'owner' | 'admin' = 'admin';
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
  render(<AdminSettings groupId='content' tvMode />);
  fireEvent.click(await screen.findByRole('tab', { name: '视频源配置' }));

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
  render(<AdminSettings groupId='access' tvMode />);
  await screen.findByRole('tab', { name: '用户配置' });

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
  render(<AdminSettings groupId='content' tvMode />);
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
  render(<AdminSettings groupId='content' tvMode />);
  expect(await screen.findByRole('alert')).toHaveTextContent('无权限');
  expect(
    screen.queryByRole('tablist', { name: '内容与站点' })
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
  expect(
    await screen.findByRole('tablist', { name: '内容与站点' })
  ).toBeInTheDocument();
});

it('associates visible site and registration labels with their actual controls', async () => {
  const { rerender } = render(<AdminSettings groupId='content' tvMode />);
  await screen.findByRole('tab', { name: '站点配置' });
  rerender(<AdminSettings groupId='access' tvMode />);

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

it('keeps unsaved forms mounted across tabs and management groups', async () => {
  const { rerender } = render(<AdminSettings groupId='content' />);
  const name = await screen.findByLabelText('站点名称');
  fireEvent.change(name, { target: { value: '未保存' } });
  fireEvent.click(screen.getByRole('tab', { name: '视频源配置' }));
  expect(screen.getByRole('tabpanel', { name: '视频源配置' })).toBeVisible();
  expect(name).not.toBeVisible();
  rerender(<AdminSettings groupId='access' />);
  expect(screen.getByRole('tabpanel', { name: '用户配置' })).toBeVisible();
  rerender(<AdminSettings groupId='content' />);
  expect(screen.getByRole('tab', { name: '视频源配置' })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  fireEvent.click(screen.getByRole('tab', { name: '站点配置' }));
  expect(name).toBeVisible();
  expect(name).toHaveValue('未保存');
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('opens the requested panel inside its management group', async () => {
  render(
    <AdminSettings groupId='content' initialSection='videoSource' tvMode />
  );
  expect(
    await screen.findByRole('tabpanel', { name: '视频源配置' })
  ).toBeVisible();
  expect(screen.getAllByRole('tab')).toHaveLength(2);
  expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
});

it('switches settings tabs with desktop arrow keys', async () => {
  render(<AdminSettings groupId='content' />);
  const first = await screen.findByRole('tab', { name: '站点配置' });
  first.focus();
  fireEvent.keyDown(first, { key: 'ArrowRight' });
  expect(screen.getByRole('tab', { name: '视频源配置' })).toHaveFocus();
  expect(screen.getByRole('tabpanel', { name: '视频源配置' })).toBeVisible();
});
