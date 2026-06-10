/* eslint-disable no-console,@typescript-eslint/no-explicit-any */

'use client';

import { KeyRound, LogOut, Shield, User, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { getRuntimeCurrentUser } from '@/lib/auth';

interface AuthInfo {
  username?: string | null;
  role?: 'owner' | 'admin' | 'user';
}

const iconButtonClassName =
  'w-11 h-11 rounded-ui-sm border border-white/10 bg-white/5 p-2 text-[rgb(var(--ui-text-muted))] shadow-ui-soft transition hover:bg-white/10 hover:text-[rgb(var(--ui-text))]';

const menuItemClassName =
  'flex w-full items-center gap-2.5 rounded-ui-sm px-3 py-2.5 text-left text-sm font-medium text-[rgb(var(--ui-text-muted))] transition hover:bg-white/10 hover:text-[rgb(var(--ui-text))]';

const dangerMenuItemClassName =
  'flex w-full items-center gap-2.5 rounded-ui-sm px-3 py-2.5 text-left text-sm font-medium text-[rgb(var(--ui-critical))] transition hover:bg-[rgba(var(--ui-critical),0.15)] hover:text-[rgb(var(--ui-critical))]';

const modalPanelClassName =
  'fixed left-1/2 top-1/2 z-[1001] max-h-[90vh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-ui-lg border border-white/10 bg-[rgba(var(--ui-surface),0.9)] p-6 text-[rgb(var(--ui-text))] shadow-ui-strong backdrop-blur-2xl';

const inputClassName =
  'w-full rounded-ui-sm border border-white/10 bg-white/5 px-3 py-2 text-sm text-[rgb(var(--ui-text))] transition-colors placeholder:text-[rgb(var(--ui-text-muted))] focus:border-[rgb(var(--ui-accent))] focus:outline-none focus:ring-2 focus:ring-[rgba(var(--ui-accent),0.34)] disabled:cursor-not-allowed disabled:opacity-55';

export const UserMenu: React.FC = () => {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  const [authInfo, setAuthInfo] = useState<AuthInfo | null>(null);
  const [storageType, setStorageType] = useState<string>('localstorage');
  const [mounted, setMounted] = useState(false);

  // 修改密码相关状态
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState('');

  // 确保组件已挂载
  useEffect(() => {
    setMounted(true);
  }, []);

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

  const handleCloseMenu = () => {
    setIsOpen(false);
  };

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

  const handleAdminPanel = () => {
    setIsOpen(false);
    router.push('/admin');
  };

  const handleChangePassword = () => {
    setIsOpen(false);
    setIsChangePasswordOpen(true);
    setNewPassword('');
    setConfirmPassword('');
    setPasswordError('');
  };

  const handleCloseChangePassword = () => {
    setIsChangePasswordOpen(false);
    setNewPassword('');
    setConfirmPassword('');
    setPasswordError('');
  };

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
    if (showAdminPanel) {
      router.prefetch('/admin');
    }
  }, [router, showAdminPanel]);

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

  // 菜单面板内容
  const menuPanel = (
    <>
      {/* 背景遮罩 - 普通菜单无需模糊 */}
      <div
        className='fixed inset-0 z-[1000] bg-transparent'
        onClick={handleCloseMenu}
      />

      {/* 菜单面板 */}
      <div className='fixed right-4 top-16 z-[1001] w-72 select-none overflow-hidden rounded-ui-lg border border-white/10 bg-[rgba(var(--ui-surface),0.9)] p-2 text-[rgb(var(--ui-text))] shadow-ui-strong backdrop-blur-2xl'>
        {/* 用户信息区域 */}
        <div className='rounded-ui-md border border-white/10 bg-white/[0.06] px-3 py-3'>
          <div className='space-y-1'>
            <div className='flex items-center justify-between'>
              <span className='text-xs font-semibold uppercase tracking-[0.22em] text-[rgb(var(--ui-text-muted))]'>
                当前用户
              </span>
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
                  (authInfo?.role || 'user') === 'owner'
                    ? 'border-[rgba(var(--ui-accent),0.45)] bg-[rgba(var(--ui-accent),0.14)] text-[rgb(var(--ui-accent))]'
                    : (authInfo?.role || 'user') === 'admin'
                    ? 'border-[rgba(var(--ui-accent),0.45)] bg-[rgba(var(--ui-accent),0.14)] text-[rgb(var(--ui-accent))]'
                    : 'border-[rgba(var(--ui-success),0.3)] bg-[rgba(var(--ui-success),0.1)] text-[rgb(var(--ui-success))]'
                }`}
              >
                {getRoleText(authInfo?.role || 'user')}
              </span>
            </div>
            <div className='flex items-center justify-between'>
              <div className='truncate text-sm font-semibold text-[rgb(var(--ui-text))]'>
                {authInfo?.username || 'default'}
              </div>
              <div className='text-[10px] text-[rgb(var(--ui-text-muted))]'>
                数据存储：
                {storageType === 'localstorage' ? '本地' : storageType}
              </div>
            </div>
          </div>
        </div>

        {/* 菜单项 */}
        <div className='space-y-1 py-2'>
          <p className='px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-[rgb(var(--ui-accent-warm))]'>
            账号操作
          </p>

          {/* 管理面板按钮 */}
          {showAdminPanel && (
            <button
              onClick={handleAdminPanel}
              onFocus={() => router.prefetch('/admin')}
              onMouseEnter={() => router.prefetch('/admin')}
              className={menuItemClassName}
            >
              <Shield className='h-4 w-4' />
              <span>管理面板</span>
            </button>
          )}

          {/* 修改密码按钮 */}
          {showChangePassword && (
            <button
              onClick={handleChangePassword}
              className={menuItemClassName}
            >
              <KeyRound className='h-4 w-4' />
              <span>修改密码</span>
            </button>
          )}

          {/* 分割线 */}
          <div className='my-2 border-t border-white/10'></div>

          {/* 登出按钮 */}
          <button onClick={handleLogout} className={dangerMenuItemClassName}>
            <LogOut className='h-4 w-4' />
            <span>退出登录</span>
          </button>
        </div>
      </div>
    </>
  );

  // 修改密码面板内容
  const changePasswordPanel = (
    <>
      {/* 背景遮罩 */}
      <div
        className='fixed inset-0 z-[1000] bg-black/70 backdrop-blur-md'
        onClick={handleCloseChangePassword}
      />

      {/* 修改密码面板 */}
      <div className={modalPanelClassName}>
        {/* 标题栏 */}
        <div className='flex items-center justify-between mb-6'>
          <h3 className='text-xl font-semibold text-[rgb(var(--ui-text))]'>
            修改密码
          </h3>
          <button
            onClick={handleCloseChangePassword}
            className='flex h-8 w-8 items-center justify-center rounded-full text-[rgb(var(--ui-text-muted))] transition-colors hover:bg-white/10 hover:text-[rgb(var(--ui-text))]'
            aria-label='Close'
          >
            <X className='h-5 w-5' />
          </button>
        </div>

        {/* 表单 */}
        <div className='space-y-4'>
          {/* 新密码输入 */}
          <div>
            <label className='mb-2 block text-sm font-medium text-[rgb(var(--ui-text))]'>
              新密码
            </label>
            <input
              type='password'
              className={inputClassName}
              placeholder='请输入新密码'
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              disabled={passwordLoading}
            />
          </div>

          {/* 确认密码输入 */}
          <div>
            <label className='mb-2 block text-sm font-medium text-[rgb(var(--ui-text))]'>
              确认密码
            </label>
            <input
              type='password'
              className={inputClassName}
              placeholder='请再次输入新密码'
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={passwordLoading}
            />
          </div>

          {/* 错误信息 */}
          {passwordError && (
            <div className='rounded-ui-sm border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-200'>
              {passwordError}
            </div>
          )}
        </div>

        {/* 操作按钮 */}
        <div className='mt-6 flex gap-3 border-t border-white/10 pt-4'>
          <button
            onClick={handleCloseChangePassword}
            className='flex-1 rounded-ui-sm border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-[rgb(var(--ui-text))] transition-colors hover:bg-white/10 disabled:opacity-50'
            disabled={passwordLoading}
          >
            取消
          </button>
          <button
            onClick={handleSubmitChangePassword}
            className='flex-1 rounded-ui-sm bg-[rgb(var(--ui-accent))] px-4 py-2 text-sm font-medium text-white transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50'
            disabled={passwordLoading || !newPassword || !confirmPassword}
          >
            {passwordLoading ? '修改中...' : '确认修改'}
          </button>
        </div>

        {/* 底部说明 */}
        <div className='mt-4 border-t border-white/10 pt-4'>
          <p className='text-center text-xs text-[rgb(var(--ui-text-muted))]'>
            修改密码后需要重新登录
          </p>
        </div>
      </div>
    </>
  );

  return (
    <>
      <div className='relative'>
        <button
          onClick={handleMenuClick}
          className={iconButtonClassName}
          aria-label='User Menu'
        >
          <User className='h-full w-full' />
        </button>
      </div>

      {/* 使用 Portal 将菜单面板渲染到 document.body */}
      {isOpen && mounted && createPortal(menuPanel, document.body)}

      {/* 使用 Portal 将修改密码面板渲染到 document.body */}
      {isChangePasswordOpen &&
        mounted &&
        createPortal(changePasswordPanel, document.body)}
    </>
  );
};
