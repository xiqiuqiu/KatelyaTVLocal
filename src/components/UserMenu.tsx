/* eslint-disable no-console,@typescript-eslint/no-explicit-any */

'use client';

import {
  Heart,
  History,
  KeyRound,
  LogOut,
  Palette,
  Shield,
  Tv,
  User,
  X,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { getRuntimeCurrentUser } from '@/lib/auth';
import { buildTvModeHref } from '@/lib/tv-interaction';
import { managementSettingsGroups } from '@/lib/ui/settings';

import { ThemeToggle } from '@/components/ThemeToggle';
import useTvBrowseNavigation from '@/components/useTvBrowseNavigation';

const AdminSettings = dynamic(
  () =>
    import('@/components/admin/AdminSettings.js').then(
      (module) => module.AdminSettings
    ),
  {
    ssr: false,
    loading: () => <p role='status'>正在加载管理配置…</p>,
  }
);
type ManagementGroupId = (typeof managementSettingsGroups)[number]['id'];
type ManagementSection =
  (typeof managementSettingsGroups)[number]['items'][number]['id'];

interface AuthInfo {
  username?: string | null;
  role?: 'owner' | 'admin' | 'user';
}

const personalSettingsCategories = [
  { id: 'device', label: '外观与设备', icon: Palette },
  { id: 'library', label: '观看与收藏', icon: History },
  { id: 'account', label: '账号与安全', icon: User },
];

const iconButtonClassName = 'ui-icon-button';

const menuItemClassName =
  'flex min-h-11 w-full items-center gap-3 rounded-ui-sm px-3 py-3 text-left text-base font-medium text-[rgb(var(--ui-text-muted))] transition-colors hover:bg-[rgb(var(--ui-surface-strong))] hover:text-[rgb(var(--ui-text))]';

const dangerMenuItemClassName =
  'flex min-h-11 w-full items-center gap-3 rounded-ui-sm px-3 py-3 text-left text-base font-medium text-[rgb(var(--ui-critical))] transition hover:bg-[rgba(var(--ui-critical),0.15)] hover:text-[rgb(var(--ui-critical))]';

const modalPanelClassName =
  'fixed left-1/2 top-1/2 z-[1001] max-h-[90vh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-ui-lg border border-[rgb(var(--ui-border))] bg-[rgb(var(--ui-surface))] p-6 text-[rgb(var(--ui-text))] shadow-ui-strong';

const inputClassName =
  'w-full rounded-ui-sm min-h-11 border border-[rgb(var(--ui-border))] bg-[rgb(var(--ui-surface-strong))] px-3 py-2 text-base text-[rgb(var(--ui-text))] transition-colors placeholder:text-[rgb(var(--ui-text-muted))] focus:border-[rgb(var(--ui-accent))] focus:outline-none focus:ring-2 focus:ring-[rgba(var(--ui-accent),0.34)] disabled:cursor-not-allowed disabled:opacity-55';

interface UserMenuProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  tvMode?: boolean;
  modeHref?: string;
}

function UserMenuPanel({ session }: { session: UserMenuSession }) {
  const panelRef = useRef<HTMLDivElement>(null);
  useTvBrowseNavigation(
    panelRef,
    session.tvMode && session.pathname === '/play',
    '/settings',
    true
  );
  const [category, setCategory] = useState(
    session.initialManagementSection ? 'management' : 'device'
  );
  const [managementGroup, setManagementGroup] = useState<ManagementGroupId>(
    managementSettingsGroups.find((group) =>
      group.items.some((item) => item.id === session.initialManagementSection)
    )?.id || 'content'
  );
  const [managementMounted, setManagementMounted] = useState(
    Boolean(session.initialManagementSection)
  );
  useEffect(() => {
    if (!session.initialManagementSection) return;
    setCategory('management');
    setManagementMounted(true);
    setManagementGroup(
      managementSettingsGroups.find((group) =>
        group.items.some((item) => item.id === session.initialManagementSection)
      )?.id || 'content'
    );
  }, [session.initialManagementSection]);
  const selectCategory = (value: string) => {
    const group = managementSettingsGroups.find((item) => item.id === value);
    if (group && session.showAdminPanel) {
      setCategory('management');
      setManagementGroup(group.id);
      setManagementMounted(true);
    } else if (personalSettingsCategories.some((item) => item.id === value)) {
      setCategory(value);
    }
    panelRef.current
      ?.querySelector('.ui-settings-content')
      ?.scrollTo?.({ top: 0 });
  };
  return (
    <>
      {/* 背景遮罩 - 普通菜单无需模糊 */}
      <button
        type='button'
        aria-label='关闭菜单'
        tabIndex={-1}
        className='fixed inset-0 z-[1000] bg-black/50'
        onClick={session.handleCloseMenu}
      />

      {/* 菜单面板 */}
      <div
        ref={panelRef}
        role='dialog'
        aria-modal='true'
        aria-label='设置与账号'
        aria-hidden={!session.isOpen}
        data-tv-mode={session.tvMode}
        data-management={category === 'management' || undefined}
        data-tv-browse={session.tvMode}
        data-open={session.isMenuVisible ? 'true' : 'false'}
        className='ui-user-menu-panel z-[1001] rounded-ui-lg border border-[rgb(var(--ui-border))] bg-[rgb(var(--ui-surface))] p-0 text-[rgb(var(--ui-text))] shadow-ui-strong transition-opacity duration-[180ms] data-[open=false]:pointer-events-none data-[open=false]:opacity-0 data-[open=true]:opacity-100'
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return;
          const controls = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              'button:not(:disabled), a[href], input:not(:disabled):not([type=hidden]), textarea:not(:disabled), select:not(:disabled)'
            )
          ).filter(
            (control) =>
              control.tabIndex !== -1 &&
              !control.closest('[hidden], [inert], [aria-hidden="true"]')
          );
          const first = controls[0];
          const last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        <div className='ui-settings-header flex shrink-0 items-center justify-between gap-4'>
          <h2 className='text-lg font-semibold'>设置与账号</h2>
          <button
            type='button'
            autoFocus
            data-tv-back
            aria-label='关闭设置与账号'
            className='ui-icon-button'
            onClick={session.handleCloseMenu}
          >
            <X aria-hidden className='h-5 w-5' />
          </button>
        </div>
        <label className='ui-settings-mobile-nav'>
          设置分类
          <select
            value={category === 'management' ? managementGroup : category}
            onChange={(event) => selectCategory(event.target.value)}
          >
            <optgroup label='个人设置'>
              {personalSettingsCategories.map(({ id, label }) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </optgroup>
            {session.showAdminPanel && (
              <optgroup label='站点管理'>
                {managementSettingsGroups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.label}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
        <div className='ui-settings-layout grid min-h-0'>
          <nav aria-label='设置分类' className='ui-settings-nav'>
            <div
              className='ui-settings-nav-group'
              role='group'
              aria-label='个人设置'
            >
              <p className='ui-settings-nav-label'>个人设置</p>
              {personalSettingsCategories.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type='button'
                  aria-pressed={category === id}
                  aria-controls={`user-settings-${id}`}
                  data-active={category === id || undefined}
                  className={menuItemClassName}
                  onClick={() => selectCategory(id)}
                >
                  <Icon aria-hidden className='h-5 w-5 shrink-0' />
                  {label}
                </button>
              ))}
            </div>
            {session.showAdminPanel && (
              <div
                className='ui-settings-nav-group'
                role='group'
                aria-label='站点管理分类'
              >
                <p className='ui-settings-nav-label'>站点管理</p>
                {managementSettingsGroups.map((group) => (
                  <button
                    key={group.id}
                    type='button'
                    aria-pressed={
                      category === 'management' && managementGroup === group.id
                    }
                    aria-controls='user-settings-management'
                    data-active={
                      (category === 'management' &&
                        managementGroup === group.id) ||
                      undefined
                    }
                    className={menuItemClassName}
                    onClick={() => selectCategory(group.id)}
                  >
                    <Shield aria-hidden className='h-5 w-5 shrink-0' />
                    {group.label}
                  </button>
                ))}
              </div>
            )}
          </nav>
          <div className='ui-settings-content min-h-0 min-w-0 overflow-y-auto'>
            <section
              id='user-settings-library'
              hidden={category !== 'library'}
              aria-labelledby='user-settings-library-title'
              className='ui-settings-group scroll-mt-4'
            >
              <h3
                id='user-settings-library-title'
                className='ui-settings-title'
              >
                观看与收藏
              </h3>
              <Link
                href={
                  session.tvMode
                    ? buildTvModeHref('/?tab=favorites', true)
                    : '/?tab=favorites'
                }
                className={menuItemClassName}
                onClick={session.handleCloseMenu}
              >
                <Heart aria-hidden className='h-5 w-5 shrink-0' />
                <span>我的收藏</span>
              </Link>
              <Link
                href={
                  session.tvMode
                    ? buildTvModeHref('/history', true)
                    : '/history'
                }
                className={menuItemClassName}
                onClick={session.handleCloseMenu}
              >
                <History aria-hidden className='h-5 w-5 shrink-0' />
                <span>播放历史</span>
              </Link>
            </section>

            <section
              id='user-settings-device'
              hidden={category !== 'device'}
              aria-labelledby='user-settings-device-title'
              className='ui-settings-group'
            >
              <h3 id='user-settings-device-title' className='ui-settings-title'>
                外观与设备
              </h3>
              <div className='ui-settings-row flex items-center justify-between gap-4'>
                <div>
                  <div className='text-base font-medium'>外观</div>
                  <p className='mt-1 text-sm text-[rgb(var(--ui-text-muted))]'>
                    切换深浅色后立即生效
                  </p>
                </div>
                <ThemeToggle />
              </div>
              <Link
                href={buildTvModeHref(
                  [
                    '/',
                    '/search',
                    '/history',
                    '/play',
                    '/douban',
                    '/admin',
                  ].includes(session.pathname)
                    ? session.modeTarget
                    : '/',
                  !session.tvMode
                )}
                className={menuItemClassName}
                onClick={session.handleCloseMenu}
              >
                <Tv aria-hidden className='h-5 w-5' />
                {session.tvMode ? '退出电视模式' : '进入电视模式'}
              </Link>
            </section>

            <section
              id='user-settings-account'
              hidden={category !== 'account'}
              aria-labelledby='user-settings-account-title'
              className='ui-settings-group'
            >
              <h3
                id='user-settings-account-title'
                className='ui-settings-title'
              >
                账号与安全
              </h3>
              <div className='ui-settings-account space-y-2'>
                <div className='flex flex-wrap items-center justify-between gap-2'>
                  <span className='break-all text-base font-semibold'>
                    {session.authInfo?.username || 'default'}
                  </span>
                  <span className='text-sm text-[rgb(var(--ui-text-muted))]'>
                    {session.getRoleText(session.authInfo?.role || 'user')}
                  </span>
                </div>
                <p className='text-sm text-[rgb(var(--ui-text-muted))]'>
                  数据存储：
                  {session.storageType === 'localstorage'
                    ? '本地'
                    : session.storageType}
                </p>
              </div>
              {session.showChangePassword && (
                <button
                  onClick={session.handleChangePassword}
                  className={menuItemClassName}
                >
                  <KeyRound aria-hidden className='h-5 w-5' />
                  <span>修改密码</span>
                </button>
              )}
              <button
                onClick={session.handleLogout}
                className={dangerMenuItemClassName}
              >
                <LogOut aria-hidden className='h-5 w-5' />
                <span>退出登录</span>
              </button>
            </section>

            {session.showAdminPanel && (
              <section
                id='user-settings-management'
                hidden={category !== 'management'}
                aria-labelledby='user-settings-management-title'
                className='ui-settings-group'
              >
                <span id='user-settings-management-title' className='sr-only'>
                  站点管理
                </span>
                {(managementMounted || category === 'management') && (
                  <AdminSettings
                    groupId={managementGroup}
                    initialSection={
                      session.initialManagementSection || undefined
                    }
                    tvMode={session.tvMode}
                  />
                )}
              </section>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function ChangePasswordPanel({ session }: { session: UserMenuSession }) {
  const { editingPassword, setEditingPassword } = session;
  return (
    <>
      {/* 背景遮罩 */}
      <button
        type='button'
        aria-label='关闭修改密码'
        tabIndex={-1}
        className='fixed inset-0 z-[1000] bg-black/60'
        onClick={session.handleCloseChangePassword}
      />

      {/* 修改密码面板 */}
      <div
        role='dialog'
        aria-modal='true'
        aria-label='修改密码'
        data-tv-browse={session.tvMode}
        data-tv-mode={session.tvMode}
        className={`ui-password-panel ${modalPanelClassName}`}
        onKeyDown={(event) => {
          if (event.key === 'Tab') {
            const controls = Array.from(
              event.currentTarget.querySelectorAll<HTMLElement>(
                'button:not(:disabled), input:not(:disabled)'
              )
            );
            const first = controls[0];
            const last = controls[controls.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
          if (!session.tvMode || !(event.target instanceof HTMLInputElement))
            return;
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (
            ['Escape', 'BrowserBack'].includes(event.key) ||
            event.keyCode === 4
          ) {
            event.preventDefault();
            event.stopPropagation();
            setEditingPassword(null);
          } else if (event.key === 'ArrowDown' && editingPassword) {
            event.preventDefault();
            setEditingPassword(null);
            document
              .getElementById(
                event.target.id === 'user-menu-new-password'
                  ? 'user-menu-confirm-password'
                  : 'user-menu-password-cancel'
              )
              ?.focus();
          }
        }}
      >
        {/* 标题栏 */}
        <div className='flex items-center justify-between mb-6'>
          <h3 className='text-xl font-semibold text-[rgb(var(--ui-text))]'>
            修改密码
          </h3>
          <button
            type='button'
            onClick={session.handleCloseChangePassword}
            className='ui-icon-button'
            aria-label='关闭修改密码'
            autoFocus
            data-tv-back
          >
            <X className='h-5 w-5' />
          </button>
        </div>

        {/* 表单 */}
        <div className='space-y-4'>
          {/* 新密码输入 */}
          <div>
            <label
              htmlFor='user-menu-new-password'
              className='mb-2 block text-sm font-medium text-[rgb(var(--ui-text))]'
            >
              新密码
            </label>
            <input
              id='user-menu-new-password'
              type='password'
              data-tv-input={session.tvMode ? '' : undefined}
              readOnly={session.tvMode && editingPassword !== 'new'}
              onClick={() => setEditingPassword('new')}
              onBlur={() => setEditingPassword(null)}
              className={inputClassName}
              placeholder='请输入新密码'
              value={session.newPassword}
              onChange={(e) => session.setNewPassword(e.target.value)}
              disabled={session.passwordLoading}
            />
          </div>

          {/* 确认密码输入 */}
          <div>
            <label
              htmlFor='user-menu-confirm-password'
              className='mb-2 block text-sm font-medium text-[rgb(var(--ui-text))]'
            >
              确认密码
            </label>
            <input
              id='user-menu-confirm-password'
              type='password'
              data-tv-input={session.tvMode ? '' : undefined}
              readOnly={session.tvMode && editingPassword !== 'confirm'}
              onClick={() => setEditingPassword('confirm')}
              onBlur={() => setEditingPassword(null)}
              className={inputClassName}
              placeholder='请再次输入新密码'
              value={session.confirmPassword}
              onChange={(e) => session.setConfirmPassword(e.target.value)}
              disabled={session.passwordLoading}
            />
          </div>

          {/* 错误信息 */}
          {session.passwordError && (
            <div
              role='alert'
              className='rounded-ui-sm bg-[rgb(var(--ui-critical)/0.12)] p-3 text-sm text-[rgb(var(--ui-critical))]'
            >
              {session.passwordError}
            </div>
          )}
        </div>

        {/* 操作按钮 */}
        <div className='mt-6 flex gap-3 border-t border-[rgb(var(--ui-border))] pt-4'>
          <button
            id='user-menu-password-cancel'
            data-tv-back
            onClick={session.handleCloseChangePassword}
            className='ui-secondary-button flex-1'
            disabled={session.passwordLoading}
          >
            取消
          </button>
          <button
            onClick={session.handleSubmitChangePassword}
            className='ui-primary-button flex-1'
            disabled={
              session.passwordLoading ||
              !session.newPassword ||
              !session.confirmPassword
            }
          >
            {session.passwordLoading ? '修改中...' : '确认修改'}
          </button>
        </div>

        {/* 底部说明 */}
        <div className='mt-4 border-t border-[rgb(var(--ui-border))] pt-4'>
          <p className='text-center text-xs text-[rgb(var(--ui-text-muted))]'>
            修改密码后需要重新登录
          </p>
        </div>
      </div>
    </>
  );
}

type UserMenuSession = {
  initialManagementSection: ManagementSection | null;
  editingPassword: string | null;
  setEditingPassword: (value: string | null) => void;
  authInfo: any;
  confirmPassword: any;
  getRoleText: any;
  handleChangePassword: any;
  handleCloseChangePassword: any;
  handleCloseMenu: any;
  handleLogout: any;
  handleMenuClick: any;
  handleSubmitChangePassword: any;
  isChangePasswordOpen: any;
  isMenuMounted: any;
  isMenuVisible: any;
  isOpen: any;
  modeTarget: any;
  mounted: any;
  newPassword: any;
  open: any;
  passwordError: any;
  passwordLoading: any;
  pathname: any;
  router: any;
  setConfirmPassword: any;
  setNewPassword: any;
  showAdminPanel: any;
  showChangePassword: any;
  storageType: any;
  tvMode: any;
};

const UserMenuContent = ({
  open,
  onOpenChange,
  tvMode = false,
  modeHref,
}: UserMenuProps) => {
  const router = useRouter();
  const pathname = usePathname();
  const requestedSettings = useSearchParams().get('settings');
  const requestedManagementSection =
    managementSettingsGroups
      .flatMap((group) => [...group.items])
      .find((item) => item.id === requestedSettings)?.id || null;
  const [initialManagementSection, setInitialManagementSection] =
    useState<ManagementSection | null>(null);
  const modeTarget =
    modeHref ||
    (typeof window === 'undefined'
      ? pathname
      : `${window.location.pathname}${window.location.search}`);
  const [localOpen, setLocalOpen] = useState(false);
  const isOpen = open ?? localOpen;
  const openerRef = useRef<HTMLElement | null>(null);
  const setIsOpen = useCallback(
    (value: boolean) => {
      setLocalOpen(value);
      onOpenChange?.(value);
    },
    [onOpenChange]
  );
  const [isMenuMounted, setIsMenuMounted] = useState(false);
  const [isMenuVisible, setIsMenuVisible] = useState(false);
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  const [authInfo, setAuthInfo] = useState<AuthInfo | null>(null);
  const [storageType, setStorageType] = useState<string>('localstorage');
  const [mounted, setMounted] = useState(false);

  // 修改密码相关状态
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [editingPassword, setEditingPassword] = useState<string | null>(null);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState('');

  // 确保组件已挂载
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setIsOpen(false);
  }, [pathname, setIsOpen]);

  useEffect(() => {
    if (isOpen) {
      openerRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      setIsMenuMounted(true);
      const frame = requestAnimationFrame(() => setIsMenuVisible(true));
      return () => cancelAnimationFrame(frame);
    }

    setIsMenuVisible(false);
    const timer = window.setTimeout(() => {
      setIsMenuMounted(false);
      if (!isChangePasswordOpen && openerRef.current?.isConnected)
        openerRef.current.focus();
    }, 180);
    return () => window.clearTimeout(timer);
  }, [isOpen, isChangePasswordOpen]);

  // 获取认证信息和存储类型
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const auth = getRuntimeCurrentUser();
    setAuthInfo(auth);

    const type = (window as any).RUNTIME_CONFIG?.STORAGE_TYPE || 'localstorage';
    setStorageType(type);

    fetch('/api/session')
      .then((response) => response.json())
      .then((data) => {
        if (data?.authenticated) {
          setAuthInfo(data.user);
        }
      })
      .catch(() => {
        // keep runtime fallback
      });
  }, []);

  const handleMenuClick = () => {
    setIsOpen(!isOpen);
  };

  const handleCloseMenu = useCallback(() => {
    setIsOpen(false);
    if (requestedSettings) {
      const url = new URL(window.location.href);
      url.searchParams.delete('settings');
      router.replace(`${url.pathname}${url.search}${url.hash}`, {
        scroll: false,
      });
    }
  }, [setIsOpen, requestedSettings, router]);

  const handleLogout = async () => {
    try {
      await fetch('/api/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error('注销请求失败:', error);
    }
    window.location.href = '/';
  };

  const handleChangePassword = () => {
    setIsOpen(false);
    setIsChangePasswordOpen(true);
    setNewPassword('');
    setConfirmPassword('');
    setPasswordError('');
    setEditingPassword(null);
  };

  const handleCloseChangePassword = () => {
    setIsChangePasswordOpen(false);
    setNewPassword('');
    setConfirmPassword('');
    setPasswordError('');
    setEditingPassword(null);
  };

  useEffect(() => {
    if (!isOpen && !isChangePasswordOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (
        event.key !== 'Escape' ||
        document.querySelector('.swal2-container')
      ) {
        return;
      }

      if (isChangePasswordOpen) {
        handleCloseChangePassword();
      } else if (isOpen) {
        handleCloseMenu();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, isChangePasswordOpen, handleCloseMenu]);

  const handleSubmitChangePassword = async () => {
    setPasswordError('');

    // 验证密码
    if (!newPassword) {
      setPasswordError('新密码不得为空');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('两次输入的密码不一致');
      return;
    }

    setPasswordLoading(true);

    try {
      const response = await fetch('/api/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          newPassword,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setPasswordError(data.error || '修改密码失败');
        return;
      }

      // 修改成功，关闭弹窗并登出
      setIsChangePasswordOpen(false);
      await handleLogout();
    } catch (error) {
      setPasswordError('网络错误，请稍后重试');
    } finally {
      setPasswordLoading(false);
    }
  };

  // 检查是否显示管理面板按钮
  const showAdminPanel =
    authInfo?.role === 'owner' || authInfo?.role === 'admin';

  useEffect(() => {
    if (!showAdminPanel || !requestedManagementSection) return;
    setInitialManagementSection(requestedManagementSection);
    setIsOpen(true);
  }, [showAdminPanel, requestedManagementSection, setIsOpen]);

  // 检查是否显示修改密码按钮
  const showChangePassword =
    authInfo?.role !== 'owner' && storageType !== 'localstorage';

  // 角色中文映射
  const getRoleText = (role?: string) => {
    switch (role) {
      case 'owner':
        return '站长';
      case 'admin':
        return '管理员';
      case 'user':
        return '用户';
      default:
        return '';
    }
  };

  const session = {
    editingPassword,
    setEditingPassword,
    authInfo,
    confirmPassword,
    getRoleText,
    initialManagementSection,
    handleChangePassword,
    handleCloseChangePassword,
    handleCloseMenu,
    handleLogout,
    handleMenuClick,
    handleSubmitChangePassword,
    isChangePasswordOpen,
    isMenuMounted,
    isMenuVisible,
    isOpen,
    modeTarget,
    mounted,
    newPassword,
    open,
    passwordError,
    passwordLoading,
    pathname,
    router,
    setConfirmPassword,
    setNewPassword,
    showAdminPanel,
    showChangePassword,
    storageType,
    tvMode,
  };

  return (
    <>
      {open === undefined && (
        <div className='relative'>
          <button
            onClick={handleMenuClick}
            className={iconButtonClassName}
            aria-label='User Menu'
            aria-expanded={isOpen}
            aria-haspopup='dialog'
          >
            <User className='h-full w-full' />
          </button>
        </div>
      )}

      {/* 使用 Portal 将菜单面板渲染到 document.body */}
      {isMenuMounted &&
        mounted &&
        createPortal(<UserMenuPanel session={session} />, document.body)}

      {/* 使用 Portal 将修改密码面板渲染到 document.body */}
      {isChangePasswordOpen &&
        mounted &&
        createPortal(<ChangePasswordPanel session={session} />, document.body)}
    </>
  );
};

export const UserMenu = (props: UserMenuProps) => (
  <Suspense>
    <UserMenuContent {...props} />
  </Suspense>
);
