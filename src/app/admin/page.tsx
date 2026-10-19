/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

'use client';

export const runtime = 'edge';

import {
  closestCenter,
  DndContext,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  restrictToParentElement,
  restrictToVerticalAxis,
} from '@dnd-kit/modifiers';
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Activity,
  ChevronDown,
  ChevronUp,
  Copy,
  GripVertical,
  Settings,
  Users,
  Video,
} from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import {
  Suspense,
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react';
import Swal from 'sweetalert2';

import { AdminConfig, AdminConfigResult } from '@/lib/admin.types';
import { getRuntimeCurrentUser } from '@/lib/auth';
import { buildRegistrationInviteLink } from '@/lib/registration/invite-link';
import { isTvMode } from '@/lib/tv-interaction';
import { managementSettingsGroups } from '@/lib/ui/settings';

import PageLayout from '@/components/PageLayout';

function useRuntimeStorageType(): string | null {
  return useSyncExternalStore(
    () => () => undefined,
    () => window.RUNTIME_CONFIG?.STORAGE_TYPE ?? null,
    () => null
  );
}

function useStableNow(): number {
  return useSyncExternalStore(
    () => () => undefined,
    () => Date.now(),
    () => 0
  );
}

const adminDialogAppearance = () => ({
  customClass: {
    popup: isTvMode(new URLSearchParams(window.location.search))
      ? 'ui-admin-dialog ui-admin-dialog-tv'
      : 'ui-admin-dialog',
  },
});

// 统一弹窗方法（必须在首次使用前定义）
const showError = (message: string) =>
  Swal.fire({
    ...adminDialogAppearance(),
    icon: 'error',
    title: '错误',
    text: message,
  });

const showSuccess = (message: string) =>
  Swal.fire({
    ...adminDialogAppearance(),
    icon: 'success',
    title: '成功',
    text: message,
    timer: 2000,
    showConfirmButton: false,
  });

// 新增站点配置类型
interface SiteConfig {
  SiteName: string;
  Announcement: string;
  SearchDownstreamMaxPage: number;
  SiteInterfaceCacheTime: number;
  ImageProxy: string;
  DoubanProxy: string;
  PlaybackDebugEnabled?: boolean;
}

// 视频源数据类型
interface DataSource {
  name: string;
  key: string;
  api: string;
  detail?: string;
  disabled?: boolean;
  from: 'config' | 'custom';
}

interface AiUsageSummary {
  dayKey: string;
  find: number;
  group: number;
  total: number;
}

interface AiUsageSubject {
  subject: string;
  scope: 'user' | 'ip' | 'global';
  endpoint: 'find' | 'group';
  count: number;
  updatedAt: number;
}

interface AiUsageReport {
  generatedAt: number;
  days: AiUsageSummary[];
  today: {
    dayKey: string;
    find: {
      total: number;
      global: number;
    };
    group: {
      total: number;
      global: number;
    };
  };
  topSubjects: AiUsageSubject[];
  topUsers: AiUsageSubject[];
  topIps: AiUsageSubject[];
}

interface PlaybackDebugLogEntry {
  id: string;
  sessionId: string;
  eventType: string;
  sourceKey: string | null;
  playbackUrl: string | null;
  playbackDomain: string | null;
  title: string | null;
  runtime: string | null;
  playlistFilter: string | null;
  segmentMode: string | null;
  recoveryProfile: string | null;
  currentTime: number | null;
  duration: number | null;
  readyState: number | null;
  networkState: number | null;
  paused: boolean | null;
  ended: boolean | null;
  details: unknown;
  userAgent: string | null;
  createdAt: number;
}

interface PlaybackDebugLogResponse {
  enabled: boolean;
  logs: PlaybackDebugLogEntry[];
}

interface RegistrationInvite {
  code: string;
  maxUses: number;
  usedCount: number;
  disabled: boolean;
  expiresAt: number | null;
  createdAt: number;
  updatedAt: number;
}

// 可折叠标签组件
interface CollapsibleTabProps {
  id: string;
  title: string;
  icon?: React.ReactNode;
  isExpanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

const CollapsibleTab = ({
  id,
  title,
  icon,
  isExpanded,
  onToggle,
  children,
}: CollapsibleTabProps) => {
  return (
    <section id={`admin-${id}`} className='ui-admin-section'>
      <button
        onClick={onToggle}
        aria-expanded={isExpanded}
        aria-controls={`admin-panel-${id}`}
        className='ui-admin-section-toggle'
      >
        <div className='flex items-center gap-3'>
          {icon}
          <h3 className='text-lg font-medium text-[rgb(var(--ui-text))]'>
            {title}
          </h3>
        </div>
        <div className='text-[rgb(var(--ui-text-muted))]'>
          {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
        </div>
      </button>

      {isExpanded && (
        <div id={`admin-panel-${id}`} className='ui-admin-section-body'>
          {children}
        </div>
      )}
    </section>
  );
};

// 用户配置组件
interface UserConfigProps {
  config: AdminConfig | null;
  role: 'owner' | 'admin' | null;
  refreshConfig: () => Promise<void>;
}

const UserConfig = ({ config, role, refreshConfig }: UserConfigProps) => {
  const [userSettings, setUserSettings] = useState({
    enableRegistration: false,
  });
  const [showAddUserForm, setShowAddUserForm] = useState(false);
  const [showChangePasswordForm, setShowChangePasswordForm] = useState(false);
  const [newUser, setNewUser] = useState({
    username: '',
    password: '',
  });
  const [changePasswordUser, setChangePasswordUser] = useState({
    username: '',
    password: '',
  });

  // 当前登录用户名
  const currentUsername = getRuntimeCurrentUser()?.username || null;

  const storageType = useRuntimeStorageType();
  const isD1Storage = storageType === 'd1';
  const isUpstashStorage = storageType === 'upstash';

  useEffect(() => {
    if (config?.UserConfig) {
      setUserSettings({
        enableRegistration: config.UserConfig.AllowRegister,
      });
    }
  }, [config]);

  // 切换允许注册设置
  const toggleAllowRegister = async (value: boolean) => {
    try {
      // 先更新本地 UI
      setUserSettings((prev) => ({ ...prev, enableRegistration: value }));

      const res = await fetch('/api/admin/user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'setAllowRegister',
          allowRegister: value,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `操作失败: ${res.status}`);
      }

      await refreshConfig();
    } catch (err) {
      showError(err instanceof Error ? err.message : '操作失败');
      // revert toggle UI
      setUserSettings((prev) => ({ ...prev, enableRegistration: !value }));
    }
  };

  const handleBanUser = async (uname: string) => {
    await handleUserAction('ban', uname);
  };

  const handleUnbanUser = async (uname: string) => {
    await handleUserAction('unban', uname);
  };

  const handleSetAdmin = async (uname: string) => {
    await handleUserAction('setAdmin', uname);
  };

  const handleRemoveAdmin = async (uname: string) => {
    await handleUserAction('cancelAdmin', uname);
  };

  const handleAddUser = async () => {
    if (!newUser.username || !newUser.password) return;
    await handleUserAction('add', newUser.username, newUser.password);
    setNewUser({ username: '', password: '' });
    setShowAddUserForm(false);
  };

  const handleChangePassword = async () => {
    if (!changePasswordUser.username || !changePasswordUser.password) return;
    await handleUserAction(
      'changePassword',
      changePasswordUser.username,
      changePasswordUser.password
    );
    setChangePasswordUser({ username: '', password: '' });
    setShowChangePasswordForm(false);
  };

  const handleShowChangePasswordForm = (username: string) => {
    setChangePasswordUser({ username, password: '' });
    setShowChangePasswordForm(true);
    setShowAddUserForm(false); // 关闭添加用户表单
  };

  const handleDeleteUser = async (username: string) => {
    const { isConfirmed } = await Swal.fire({
      ...adminDialogAppearance(),
      title: '确认删除用户',
      text: `删除用户 ${username} 将同时删除其搜索历史、播放记录和收藏夹，此操作不可恢复！`,
      icon: 'warning',
      showCancelButton: true,
      focusCancel: true,
      confirmButtonText: '确认删除',
      cancelButtonText: '取消',
      confirmButtonColor: '#dc2626',
    });

    if (!isConfirmed) return;

    await handleUserAction('deleteUser', username);
  };

  // 通用请求函数
  const handleUserAction = async (
    action:
      | 'add'
      | 'ban'
      | 'unban'
      | 'setAdmin'
      | 'cancelAdmin'
      | 'changePassword'
      | 'deleteUser',
    targetUsername: string,
    targetPassword?: string
  ) => {
    try {
      const res = await fetch('/api/admin/user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUsername,
          ...(targetPassword ? { targetPassword } : {}),
          action,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `操作失败: ${res.status}`);
      }

      // 成功后刷新配置（无需整页刷新）
      await refreshConfig();
    } catch (err) {
      showError(err instanceof Error ? err.message : '操作失败');
    }
  };

  if (!config) {
    return (
      <div className='text-center text-[rgb(var(--ui-text-muted))]'>
        加载中...
      </div>
    );
  }

  return (
    <div className='space-y-6'>
      {/* 用户统计 */}
      <div>
        <h4 className='text-sm font-medium text-[rgb(var(--ui-text))] mb-3'>
          用户统计
        </h4>
        <div className='p-4 bg-[rgb(var(--ui-success)/0.1)] rounded-lg border border-[rgb(var(--ui-accent))]'>
          <div className='text-2xl font-bold text-[rgb(var(--ui-success))]'>
            {config.UserConfig.Users.length}
          </div>
          <div className='text-sm text-[rgb(var(--ui-success))]'>总用户数</div>
        </div>
      </div>

      {/* 注册设置 */}
      <div>
        <h4 className='text-sm font-medium text-[rgb(var(--ui-text))] mb-3'>
          注册设置
        </h4>
        <div className='flex items-center justify-between'>
          <label
            htmlFor='admin-allow-register'
            className={`text-[rgb(var(--ui-text))]  ${
              isD1Storage || isUpstashStorage ? 'opacity-50' : ''
            }`}
          >
            允许新用户注册
            {isD1Storage && (
              <span className='ml-2 text-xs text-[rgb(var(--ui-text-muted))]'>
                (D1 环境下请通过环境变量修改)
              </span>
            )}
            {isUpstashStorage && (
              <span className='ml-2 text-xs text-[rgb(var(--ui-text-muted))]'>
                (Upstash 环境下请通过环境变量修改)
              </span>
            )}
          </label>
          <button
            onClick={() =>
              !isD1Storage &&
              !isUpstashStorage &&
              toggleAllowRegister(!userSettings.enableRegistration)
            }
            disabled={isD1Storage || isUpstashStorage}
            id='admin-allow-register'
            role='switch'
            aria-label='允许注册'
            aria-checked={userSettings.enableRegistration}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[rgb(var(--ui-accent))] focus:ring-offset-2 ${
              userSettings.enableRegistration
                ? 'bg-[rgb(var(--ui-accent))]'
                : 'bg-[rgb(var(--ui-surface-strong))] '
            } ${
              isD1Storage || isUpstashStorage
                ? 'opacity-50 cursor-not-allowed'
                : ''
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-[rgb(var(--ui-surface))] transition-transform ${
                userSettings.enableRegistration
                  ? 'translate-x-6'
                  : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </div>

      {/* 用户列表 */}
      <div>
        <div className='flex items-center justify-between mb-3'>
          <h4 className='text-sm font-medium text-[rgb(var(--ui-text))]'>
            用户列表
          </h4>
          <button
            onClick={() => {
              setShowAddUserForm(!showAddUserForm);
              if (showChangePasswordForm) {
                setShowChangePasswordForm(false);
                setChangePasswordUser({ username: '', password: '' });
              }
            }}
            className='px-3 py-1 bg-[rgb(var(--ui-accent))] hover:bg-[rgb(var(--ui-accent))] text-[rgb(var(--ui-on-accent))] text-sm rounded-lg transition-colors'
          >
            {showAddUserForm ? '取消' : '添加用户'}
          </button>
        </div>

        {/* 添加用户表单 */}
        {showAddUserForm && (
          <div className='mb-4 p-4 bg-[rgb(var(--ui-surface))] rounded-lg border border-[rgb(var(--ui-border))]'>
            <div className='flex flex-col sm:flex-row gap-4 sm:gap-3'>
              <input
                type='text'
                aria-label='用户名'
                placeholder='用户名'
                value={newUser.username}
                onChange={(e) =>
                  setNewUser((prev) => ({ ...prev, username: e.target.value }))
                }
                className='flex-1 px-3 py-2 border border-[rgb(var(--ui-border))] rounded-lg bg-[rgb(var(--ui-surface))] text-[rgb(var(--ui-text))] focus:ring-2 focus:ring-[rgb(var(--ui-accent))] focus:border-transparent'
              />
              <input
                type='password'
                aria-label='密码'
                placeholder='密码'
                value={newUser.password}
                onChange={(e) =>
                  setNewUser((prev) => ({ ...prev, password: e.target.value }))
                }
                className='flex-1 px-3 py-2 border border-[rgb(var(--ui-border))] rounded-lg bg-[rgb(var(--ui-surface))] text-[rgb(var(--ui-text))] focus:ring-2 focus:ring-[rgb(var(--ui-accent))] focus:border-transparent'
              />
              <button
                onClick={handleAddUser}
                disabled={!newUser.username || !newUser.password}
                className='w-full sm:w-auto px-4 py-2 bg-[rgb(var(--ui-accent))] hover:bg-[rgb(var(--ui-accent))] disabled:bg-[rgb(var(--ui-surface-strong))] text-[rgb(var(--ui-on-accent))] rounded-lg transition-colors'
              >
                添加
              </button>
            </div>
          </div>
        )}

        {/* 修改密码表单 */}
        {showChangePasswordForm && (
          <div className='mb-4 p-4 bg-[rgb(var(--ui-accent)/0.1)] rounded-lg border border-[rgb(var(--ui-accent))]'>
            <h5 className='text-sm font-medium text-[rgb(var(--ui-accent))] mb-3'>
              修改用户密码
            </h5>
            <div className='flex flex-col sm:flex-row gap-4 sm:gap-3'>
              <input
                type='text'
                aria-label='用户名'
                placeholder='用户名'
                value={changePasswordUser.username}
                disabled
                className='flex-1 px-3 py-2 border border-[rgb(var(--ui-border))] rounded-lg bg-[rgb(var(--ui-surface))] text-[rgb(var(--ui-text))] cursor-not-allowed'
              />
              <input
                type='password'
                aria-label='新密码'
                placeholder='新密码'
                value={changePasswordUser.password}
                onChange={(e) =>
                  setChangePasswordUser((prev) => ({
                    ...prev,
                    password: e.target.value,
                  }))
                }
                className='flex-1 px-3 py-2 border border-[rgb(var(--ui-border))] rounded-lg bg-[rgb(var(--ui-surface))] text-[rgb(var(--ui-text))] focus:ring-2 focus:ring-[rgb(var(--ui-accent))] focus:border-transparent'
              />
              <button
                onClick={handleChangePassword}
                disabled={!changePasswordUser.password}
                className='w-full sm:w-auto px-4 py-2 bg-[rgb(var(--ui-accent))] hover:bg-[rgb(var(--ui-accent))] disabled:bg-[rgb(var(--ui-surface-strong))] text-[rgb(var(--ui-on-accent))] rounded-lg transition-colors'
              >
                修改密码
              </button>
              <button
                onClick={() => {
                  setShowChangePasswordForm(false);
                  setChangePasswordUser({ username: '', password: '' });
                }}
                className='w-full sm:w-auto px-4 py-2 bg-[rgb(var(--ui-surface-strong))] hover:bg-[rgb(var(--ui-surface-strong))] text-[rgb(var(--ui-text))] rounded-lg transition-colors'
              >
                取消
              </button>
            </div>
          </div>
        )}

        {/* 用户列表 */}
        <div
          className='ui-admin-table-region border border-[rgb(var(--ui-border))] rounded-lg max-h-[28rem] overflow-y-auto overflow-x-auto'
          role='region'
          aria-label='管理数据表格，可横向滚动'
          tabIndex={0}
        >
          <table className='min-w-full divide-y divide-[rgb(var(--ui-border))]'>
            <thead className='bg-[rgb(var(--ui-surface))]'>
              <tr>
                <th
                  scope='col'
                  className='px-6 py-3 text-left text-xs font-medium text-[rgb(var(--ui-text-muted))] uppercase tracking-wider'
                >
                  用户名
                </th>
                <th
                  scope='col'
                  className='px-6 py-3 text-left text-xs font-medium text-[rgb(var(--ui-text-muted))] uppercase tracking-wider'
                >
                  角色
                </th>
                <th
                  scope='col'
                  className='px-6 py-3 text-left text-xs font-medium text-[rgb(var(--ui-text-muted))] uppercase tracking-wider'
                >
                  状态
                </th>
                <th
                  scope='col'
                  className='px-6 py-3 text-right text-xs font-medium text-[rgb(var(--ui-text-muted))] uppercase tracking-wider'
                >
                  操作
                </th>
              </tr>
            </thead>
            {/* 按规则排序用户：自己 -> 站长(若非自己) -> 管理员 -> 其他 */}
            {(() => {
              const sortedUsers = [...config.UserConfig.Users].sort((a, b) => {
                type UserInfo = (typeof config.UserConfig.Users)[number];
                const priority = (u: UserInfo) => {
                  if (u.username === currentUsername) return 0;
                  if (u.role === 'owner') return 1;
                  if (u.role === 'admin') return 2;
                  return 3;
                };
                return priority(a) - priority(b);
              });
              return (
                <tbody className='divide-y divide-[rgb(var(--ui-border))]'>
                  {sortedUsers.map((user) => {
                    // 修改密码权限：站长可修改管理员和普通用户密码，管理员可修改普通用户和自己的密码，但任何人都不能修改站长密码
                    const canChangePassword =
                      user.role !== 'owner' && // 不能修改站长密码
                      (role === 'owner' || // 站长可以修改管理员和普通用户密码
                        (role === 'admin' &&
                          (user.role === 'user' ||
                            user.username === currentUsername))); // 管理员可以修改普通用户和自己的密码

                    // 删除用户权限：站长可删除除自己外的所有用户，管理员仅可删除普通用户
                    const canDeleteUser =
                      user.username !== currentUsername &&
                      (role === 'owner' || // 站长可以删除除自己外的所有用户
                        (role === 'admin' && user.role === 'user')); // 管理员仅可删除普通用户

                    // 其他操作权限：不能操作自己，站长可操作所有用户，管理员可操作普通用户
                    const canOperate =
                      user.username !== currentUsername &&
                      (role === 'owner' ||
                        (role === 'admin' && user.role === 'user'));
                    return (
                      <tr
                        key={user.username}
                        className='hover:bg-[rgb(var(--ui-surface))] transition-colors'
                      >
                        <td className='px-6 py-4 whitespace-nowrap text-sm font-medium text-[rgb(var(--ui-text))]'>
                          {user.username}
                        </td>
                        <td className='px-6 py-4 whitespace-nowrap'>
                          <span
                            className={`px-2 py-1 text-xs rounded-full ${
                              user.role === 'owner'
                                ? 'bg-[rgb(var(--ui-accent-warm)/0.1)] text-[rgb(var(--ui-accent-warm))]'
                                : user.role === 'admin'
                                ? 'bg-[rgb(var(--ui-accent)/0.1)]  text-[rgb(var(--ui-accent))] '
                                : 'bg-[rgb(var(--ui-surface))]  text-[rgb(var(--ui-text))] '
                            }`}
                          >
                            {user.role === 'owner'
                              ? '站长'
                              : user.role === 'admin'
                              ? '管理员'
                              : '普通用户'}
                          </span>
                        </td>
                        <td className='px-6 py-4 whitespace-nowrap'>
                          <span
                            className={`px-2 py-1 text-xs rounded-full ${
                              !user.banned
                                ? 'bg-[rgb(var(--ui-success)/0.1)]  text-[rgb(var(--ui-success))] '
                                : 'bg-[rgb(var(--ui-critical)/0.1)]  text-[rgb(var(--ui-critical))] '
                            }`}
                          >
                            {!user.banned ? '正常' : '已封禁'}
                          </span>
                        </td>
                        <td className='px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2'>
                          {/* 修改密码按钮 */}
                          {canChangePassword && (
                            <button
                              onClick={() =>
                                handleShowChangePasswordForm(user.username)
                              }
                              className='inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-[rgb(var(--ui-accent)/0.1)] text-[rgb(var(--ui-accent))] hover:bg-[rgb(var(--ui-accent)/0.1)] transition-colors'
                            >
                              修改密码
                            </button>
                          )}
                          {canOperate && (
                            <>
                              {/* 其他操作按钮 */}
                              {user.role === 'user' && (
                                <button
                                  onClick={() => handleSetAdmin(user.username)}
                                  className='inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-[rgb(var(--ui-accent)/0.1)] text-[rgb(var(--ui-accent))] hover:bg-[rgb(var(--ui-accent)/0.1)] transition-colors'
                                >
                                  设为管理
                                </button>
                              )}
                              {user.role === 'admin' && (
                                <button
                                  onClick={() =>
                                    handleRemoveAdmin(user.username)
                                  }
                                  className='inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-[rgb(var(--ui-surface))] text-[rgb(var(--ui-text))] hover:bg-[rgb(var(--ui-surface-strong))] transition-colors'
                                >
                                  取消管理
                                </button>
                              )}
                              {user.role !== 'owner' &&
                                (!user.banned ? (
                                  <button
                                    onClick={() => handleBanUser(user.username)}
                                    className='inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-[rgb(var(--ui-critical)/0.1)] text-[rgb(var(--ui-critical))] hover:bg-[rgb(var(--ui-critical)/0.1)] transition-colors'
                                  >
                                    封禁
                                  </button>
                                ) : (
                                  <button
                                    onClick={() =>
                                      handleUnbanUser(user.username)
                                    }
                                    className='inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-[rgb(var(--ui-success)/0.1)] text-[rgb(var(--ui-success))] hover:bg-[rgb(var(--ui-success)/0.1)] transition-colors'
                                  >
                                    解封
                                  </button>
                                ))}
                            </>
                          )}
                          {/* 删除用户按钮 - 放在最后，使用更明显的红色样式 */}
                          {canDeleteUser && (
                            <button
                              onClick={() => handleDeleteUser(user.username)}
                              className='inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-[rgb(var(--ui-critical)/0.12)] text-[rgb(var(--ui-critical))] hover:bg-[rgb(var(--ui-critical)/0.12)] transition-colors'
                            >
                              删除用户
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              );
            })()}
          </table>
        </div>
      </div>
    </div>
  );
};

const InviteConfig = () => {
  const [invites, setInvites] = useState<RegistrationInvite[]>([]);
  const [loading, setLoading] = useState(false);
  const [maxUses, setMaxUses] = useState(1);
  const [validDays, setValidDays] = useState(0);
  const now = useStableNow();

  const fetchInvites = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/admin/registration-invites');
      const data = (await response.json().catch(() => ({}))) as {
        invites?: RegistrationInvite[];
        error?: string;
        details?: string;
      };

      if (!response.ok) {
        throw new Error(data.details || data.error || '获取邀请码失败');
      }

      setInvites(data.invites || []);
    } catch (err) {
      showError(err instanceof Error ? err.message : '获取邀请码失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInvites();
  }, [fetchInvites]);

  const formatTime = (value: number | null) => {
    if (!value) return '长期有效';
    return new Date(value).toLocaleString('zh-CN', { hour12: false });
  };

  const handleCreateInvite = async () => {
    try {
      setLoading(true);
      const expiresAt =
        validDays > 0 ? Date.now() + validDays * 24 * 60 * 60 * 1000 : null;
      const response = await fetch('/api/admin/registration-invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          maxUses,
          expiresAt,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        invite?: RegistrationInvite;
        error?: string;
        details?: string;
      };

      if (!response.ok) {
        throw new Error(data.details || data.error || '生成邀请码失败');
      }

      await fetchInvites();
      showSuccess(`邀请码已生成：${data.invite?.code || ''}`);
    } catch (err) {
      showError(err instanceof Error ? err.message : '生成邀请码失败');
    } finally {
      setLoading(false);
    }
  };

  const handleDisableInvite = async (code: string) => {
    const { isConfirmed } = await Swal.fire({
      ...adminDialogAppearance(),
      title: '确认禁用邀请码',
      text: `邀请码 ${code} 禁用后不能再用于注册。`,
      icon: 'warning',
      showCancelButton: true,
      focusCancel: true,
      confirmButtonText: '确认',
      cancelButtonText: '取消',
    });
    if (!isConfirmed) return;

    try {
      setLoading(true);
      const response = await fetch('/api/admin/registration-invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'disable', code }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        details?: string;
      };

      if (!response.ok) {
        throw new Error(data.details || data.error || '禁用邀请码失败');
      }

      await fetchInvites();
      showSuccess('邀请码已禁用');
    } catch (err) {
      showError(err instanceof Error ? err.message : '禁用邀请码失败');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyInvite = async (code: string) => {
    const inviteLink = buildRegistrationInviteLink({
      code,
      origin: window.location.origin,
    });

    await navigator.clipboard.writeText(inviteLink);
    showSuccess('邀请链接已复制');
  };

  return (
    <div className='space-y-5'>
      <div className='grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3'>
        <div>
          <label
            htmlFor='admin-invite-max-uses'
            className='mb-2 block text-sm font-medium text-[rgb(var(--ui-text))]'
          >
            可使用次数
          </label>
          <input
            type='number'
            id='admin-invite-max-uses'
            aria-label='可使用次数'
            min={1}
            max={1000}
            value={maxUses}
            onChange={(e) =>
              setMaxUses(
                Math.min(1000, Math.max(1, Number(e.target.value) || 1))
              )
            }
            className='w-full px-3 py-2 border border-[rgb(var(--ui-border))] rounded-lg bg-[rgb(var(--ui-surface))] text-[rgb(var(--ui-text))]'
          />
        </div>
        <div>
          <label
            htmlFor='admin-invite-valid-days'
            className='mb-2 block text-sm font-medium text-[rgb(var(--ui-text))]'
          >
            有效天数
          </label>
          <input
            type='number'
            id='admin-invite-valid-days'
            aria-label='有效天数'
            min={0}
            max={365}
            value={validDays}
            onChange={(e) =>
              setValidDays(
                Math.min(365, Math.max(0, Number(e.target.value) || 0))
              )
            }
            className='w-full px-3 py-2 border border-[rgb(var(--ui-border))] rounded-lg bg-[rgb(var(--ui-surface))] text-[rgb(var(--ui-text))]'
          />
          <p className='mt-1 text-xs text-[rgb(var(--ui-text-muted))]'>
            0 表示长期有效
          </p>
        </div>
        <div className='flex items-end gap-2'>
          <button
            onClick={handleCreateInvite}
            disabled={loading}
            className='px-4 py-2 bg-[rgb(var(--ui-accent))] hover:bg-[rgb(var(--ui-accent))] disabled:bg-[rgb(var(--ui-surface-strong))] text-[rgb(var(--ui-on-accent))] rounded-lg transition-colors'
          >
            生成邀请码
          </button>
          <button
            onClick={fetchInvites}
            disabled={loading}
            className='px-4 py-2 bg-[rgb(var(--ui-accent))] hover:bg-[rgb(var(--ui-accent))] disabled:bg-[rgb(var(--ui-surface-strong))] text-[rgb(var(--ui-on-accent))] rounded-lg transition-colors'
          >
            刷新
          </button>
        </div>
      </div>

      <div
        className='ui-admin-table-region border border-[rgb(var(--ui-border))] rounded-lg overflow-x-auto'
        role='region'
        aria-label='管理数据表格，可横向滚动'
        tabIndex={0}
      >
        <table className='min-w-full divide-y divide-[rgb(var(--ui-border))]'>
          <thead className='bg-[rgb(var(--ui-surface))]'>
            <tr>
              <th className='px-4 py-3 text-left text-xs font-medium text-[rgb(var(--ui-text-muted))] uppercase tracking-wider'>
                邀请码
              </th>
              <th className='px-4 py-3 text-right text-xs font-medium text-[rgb(var(--ui-text-muted))] uppercase tracking-wider'>
                使用
              </th>
              <th className='px-4 py-3 text-left text-xs font-medium text-[rgb(var(--ui-text-muted))] uppercase tracking-wider'>
                有效期
              </th>
              <th className='px-4 py-3 text-left text-xs font-medium text-[rgb(var(--ui-text-muted))] uppercase tracking-wider'>
                状态
              </th>
              <th className='px-4 py-3 text-right text-xs font-medium text-[rgb(var(--ui-text-muted))] uppercase tracking-wider'>
                操作
              </th>
            </tr>
          </thead>
          <tbody className='divide-y divide-[rgb(var(--ui-border))]'>
            {invites.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className='px-4 py-6 text-center text-sm text-[rgb(var(--ui-text-muted))]'
                >
                  暂无邀请码
                </td>
              </tr>
            ) : (
              invites.map((invite) => {
                const exhausted = invite.usedCount >= invite.maxUses;
                const expired =
                  invite.expiresAt !== null && invite.expiresAt <= now;
                const active = !invite.disabled && !exhausted && !expired;

                return (
                  <tr key={invite.code}>
                    <td className='px-4 py-3 text-sm font-mono text-[rgb(var(--ui-text))]'>
                      {invite.code}
                    </td>
                    <td className='px-4 py-3 text-sm text-right text-[rgb(var(--ui-text))]'>
                      {invite.usedCount}/{invite.maxUses}
                    </td>
                    <td className='px-4 py-3 text-sm text-[rgb(var(--ui-text))]'>
                      {formatTime(invite.expiresAt)}
                    </td>
                    <td className='px-4 py-3 text-sm'>
                      <span
                        className={`inline-flex rounded-full px-2 py-1 text-xs ${
                          active
                            ? 'bg-[rgb(var(--ui-success)/0.1)] text-[rgb(var(--ui-success))]  '
                            : 'bg-[rgb(var(--ui-surface))] text-[rgb(var(--ui-text-muted))]  '
                        }`}
                      >
                        {active
                          ? '可用'
                          : invite.disabled
                          ? '已禁用'
                          : exhausted
                          ? '已用完'
                          : '已过期'}
                      </span>
                    </td>
                    <td className='px-4 py-3 text-right'>
                      <div className='inline-flex gap-2'>
                        <button
                          onClick={() => handleCopyInvite(invite.code)}
                          className='inline-flex items-center gap-1 px-2 py-1 text-xs bg-[rgb(var(--ui-accent))] hover:bg-[rgb(var(--ui-accent))] text-[rgb(var(--ui-on-accent))] rounded-md transition-colors'
                        >
                          <Copy className='h-3 w-3' />
                          复制链接
                        </button>
                        {!invite.disabled && (
                          <button
                            onClick={() => handleDisableInvite(invite.code)}
                            disabled={loading}
                            className='px-2 py-1 text-xs bg-[rgb(var(--ui-critical)/0.12)] hover:bg-[rgb(var(--ui-critical)/0.12)] disabled:bg-[rgb(var(--ui-surface-strong))] text-[rgb(var(--ui-critical))] rounded-md transition-colors'
                          >
                            禁用
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

interface DraggableRowProps {
  source: DataSource;
  index: number;
  sourceCount: number;
  onMove: (from: number, to: number) => void;
  batchMode: boolean;
  selectedSources: Set<string>;
  onSelectSource: (key: string, checked: boolean) => void;
  onToggleEnable: (key: string) => void;
  onDelete: (key: string) => void;
}

const DraggableRow = ({
  source,
  index,
  sourceCount,
  onMove,
  batchMode,
  selectedSources,
  onSelectSource,
  onToggleEnable,
  onDelete,
}: DraggableRowProps) => {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: source.key });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  } as React.CSSProperties;

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className='hover:bg-[rgb(var(--ui-surface))] transition-colors select-none'
    >
      {/* 保留拖拽，并提供键盘及遥控器等价操作。 */}
      <td className='px-2 py-4'>
        <div className='ui-admin-sort-actions'>
          <button
            className='ui-admin-drag-handle'
            aria-label={`拖动 ${source.name} 调整顺序`}
            style={{ touchAction: 'none' }}
            {...attributes}
            {...listeners}
            tabIndex={-1}
          >
            <GripVertical size={16} />
          </button>
          <button
            aria-label={`上移 ${source.name}`}
            disabled={index === 0}
            onClick={() => onMove(index, index - 1)}
            className='ui-admin-sort-button'
          >
            <ChevronUp size={18} />
          </button>
          <button
            aria-label={`下移 ${source.name}`}
            disabled={index === sourceCount - 1}
            onClick={() => onMove(index, index + 1)}
            className='ui-admin-sort-button'
          >
            <ChevronDown size={18} />
          </button>
        </div>
      </td>

      {/* 批量选择复选框 */}
      {batchMode && (
        <td className='px-4 py-4 whitespace-nowrap'>
          <input
            type='checkbox'
            aria-label={`选择 ${source.name}`}
            checked={selectedSources.has(source.key)}
            onChange={(e) => onSelectSource(source.key, e.target.checked)}
            disabled={source.from === 'config'} // 禁用示例源选择
            className='w-4 h-4 text-[rgb(var(--ui-accent))] bg-[rgb(var(--ui-surface))] border-[rgb(var(--ui-border))] rounded focus:ring-[rgb(var(--ui-accent))] focus:ring-2 disabled:opacity-50'
          />
        </td>
      )}
      <td className='px-6 py-4 whitespace-nowrap text-sm text-[rgb(var(--ui-text))]'>
        <div className='flex items-center space-x-2'>
          <span>{source.name}</span>
          {source.from === 'config' && (
            <span className='inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-[rgb(var(--ui-accent-warm)/0.1)] text-[rgb(var(--ui-accent-warm))]  '>
              示例源
            </span>
          )}
        </div>
      </td>
      <td className='px-6 py-4 whitespace-nowrap text-sm text-[rgb(var(--ui-text))]'>
        {source.key}
      </td>
      <td
        className='px-6 py-4 whitespace-nowrap text-sm text-[rgb(var(--ui-text))] max-w-[12rem] truncate'
        title={source.api}
      >
        {source.api}
      </td>
      <td
        className='px-6 py-4 whitespace-nowrap text-sm text-[rgb(var(--ui-text))] max-w-[8rem] truncate'
        title={source.detail || '-'}
      >
        {source.detail || '-'}
      </td>
      <td className='px-6 py-4 whitespace-nowrap max-w-[1rem]'>
        <span
          className={`px-2 py-1 text-xs rounded-full ${
            !source.disabled
              ? 'bg-[rgb(var(--ui-success)/0.1)]  text-[rgb(var(--ui-success))] '
              : 'bg-[rgb(var(--ui-critical)/0.1)]  text-[rgb(var(--ui-critical))] '
          }`}
        >
          {!source.disabled ? '启用中' : '已禁用'}
        </span>
      </td>
      <td className='px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2'>
        <button
          onClick={() => onToggleEnable(source.key)}
          className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium ${
            !source.disabled
              ? 'bg-[rgb(var(--ui-critical)/0.1)]  text-[rgb(var(--ui-critical))]  hover:bg-[rgb(var(--ui-critical)/0.1)] '
              : 'bg-[rgb(var(--ui-success)/0.1)]  text-[rgb(var(--ui-success))]  hover:bg-[rgb(var(--ui-success)/0.1)] '
          } transition-colors`}
        >
          {!source.disabled ? '禁用' : '启用'}
        </button>
        {source.from !== 'config' ? (
          <button
            onClick={() => onDelete(source.key)}
            className='inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-[rgb(var(--ui-surface))] text-[rgb(var(--ui-text))] hover:bg-[rgb(var(--ui-surface-strong))] transition-colors'
          >
            删除
          </button>
        ) : (
          <span className='inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-[rgb(var(--ui-surface-strong))] text-[rgb(var(--ui-text-muted))]'>
            不可删除
          </span>
        )}
      </td>
    </tr>
  );
};

// 视频源配置组件
const VideoSourceConfig = ({
  config,
  refreshConfig,
}: {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
}) => {
  const [sources, setSources] = useState<DataSource[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [orderChanged, setOrderChanged] = useState(false);
  const [batchMode, setBatchMode] = useState(false);
  const [selectedSources, setSelectedSources] = useState<Set<string>>(
    new Set()
  );
  const [newSource, setNewSource] = useState<DataSource>({
    name: '',
    key: '',
    api: '',
    detail: '',
    disabled: false,
    from: 'config',
  });

  // dnd-kit 传感器
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5, // 轻微位移即可触发
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 150, // 长按 150ms 后触发，避免与滚动冲突
        tolerance: 5,
      },
    })
  );

  // 初始化
  useEffect(() => {
    if (config?.SourceConfig) {
      setSources(config.SourceConfig);
      // 进入时重置 orderChanged
      setOrderChanged(false);
    }
  }, [config]);

  // 通用 API 请求
  const callSourceApi = async (body: Record<string, any>) => {
    try {
      const resp = await fetch('/api/admin/source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body }),
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || `操作失败: ${resp.status}`);
      }

      // 成功后刷新配置
      await refreshConfig();
    } catch (err) {
      showError(err instanceof Error ? err.message : '操作失败');
      throw err; // 向上抛出方便调用处判断
    }
  };

  const handleToggleEnable = (key: string) => {
    const target = sources.find((s) => s.key === key);
    if (!target) return;
    const action = target.disabled ? 'enable' : 'disable';
    callSourceApi({ action, key }).catch(() => {
      console.error('操作失败', action, key);
    });
  };

  const handleDelete = (key: string) => {
    // 检查是否为示例源
    const source = sources.find((s) => s.key === key);
    if (source?.from === 'config') {
      showError('示例源不可删除，这些源用于演示功能');
      return;
    }

    callSourceApi({ action: 'delete', key }).catch(() => {
      console.error('操作失败', 'delete', key);
    });
  };

  const handleAddSource = () => {
    if (!newSource.name || !newSource.key || !newSource.api) return;
    callSourceApi({
      action: 'add',
      key: newSource.key,
      name: newSource.name,
      api: newSource.api,
      detail: newSource.detail,
    })
      .then(() => {
        setNewSource({
          name: '',
          key: '',
          api: '',
          detail: '',
          disabled: false,
          from: 'custom',
        });
        setShowAddForm(false);
      })
      .catch(() => {
        console.error('操作失败', 'add', newSource);
      });
  };

  // 批量操作相关函数
  const handleToggleBatchMode = () => {
    setBatchMode(!batchMode);
    setSelectedSources(new Set()); // 切换模式时清空选择
  };

  const handleSelectSource = (key: string, checked: boolean) => {
    const newSelected = new Set(selectedSources);
    if (checked) {
      newSelected.add(key);
    } else {
      newSelected.delete(key);
    }
    setSelectedSources(newSelected);
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      // 只选择可删除的视频源（排除示例源）
      const deletableSources = sources.filter(
        (source) => source.from !== 'config'
      );
      setSelectedSources(new Set(deletableSources.map((source) => source.key)));
    } else {
      setSelectedSources(new Set());
    }
  };

  const handleBatchDelete = async () => {
    if (selectedSources.size === 0) {
      showError('请先选择要删除的视频源');
      return;
    }

    const selectedArray = Array.from(selectedSources);
    const result = await Swal.fire({
      ...adminDialogAppearance(),
      title: '确认批量删除',
      text: `即将删除 ${selectedArray.length} 个视频源，此操作不可撤销！`,
      icon: 'warning',
      showCancelButton: true,
      focusCancel: true,
      confirmButtonText: '确认删除',
      cancelButtonText: '取消',
      confirmButtonColor: '#ef4444',
      cancelButtonColor: '#6b7280',
    });

    if (!result.isConfirmed) return;

    // 批量删除逐个进行，显示进度
    let successCount = 0;
    let errorCount = 0;
    const errors: string[] = [];

    for (let i = 0; i < selectedArray.length; i++) {
      const key = selectedArray[i];
      try {
        await callSourceApi({ action: 'delete', key });
        successCount++;

        // 显示进度
        if (selectedArray.length > 1) {
          Swal.update({
            title: '正在删除...',
            text: `进度: ${i + 1}/${selectedArray.length}`,
            showConfirmButton: false,
            showCancelButton: false,
            allowOutsideClick: false,
          });
        }
      } catch (error) {
        errorCount++;
        const sourceName = sources.find((s) => s.key === key)?.name || key;
        errors.push(
          `${sourceName}: ${
            error instanceof Error ? error.message : '删除失败'
          }`
        );
      }
    }

    // 显示删除结果
    if (errorCount === 0) {
      showSuccess(`成功删除 ${successCount} 个视频源`);
      setSelectedSources(new Set()); // 清空选择
      setBatchMode(false); // 退出批量模式
    } else {
      await Swal.fire({
        ...adminDialogAppearance(),
        title: '删除完成',
        html: `
          <div class="text-left">
            <p class="text-[rgb(var(--ui-success))] mb-2">✅ 成功删除: ${successCount} 个</p>
            <p class="text-[rgb(var(--ui-critical))] mb-2">❌ 删除失败: ${errorCount} 个</p>
            ${
              errors.length > 0
                ? `
              <details class="mt-3">
                <summary class="cursor-pointer text-[rgb(var(--ui-text-muted))]">查看错误详情</summary>
                <div class="mt-2 text-sm text-[rgb(var(--ui-text-muted))] max-h-32 overflow-y-auto">
                  ${errors
                    .map((err) => `<div class="py-1">${err}</div>`)
                    .join('')}
                </div>
              </details>
            `
                : ''
            }
          </div>
        `,
        icon: successCount > 0 ? 'warning' : 'error',
        confirmButtonText: '确定',
      });

      // 清空已成功删除的选择项
      const failedKeys = new Set(
        errors
          .map((err) => {
            const keyMatch = err.split(':')[0];
            return sources.find((s) => s.name === keyMatch)?.key;
          })
          .filter((key): key is string => Boolean(key))
      );
      setSelectedSources(failedKeys);
    }

    await refreshConfig();
  };

  // 导出配置
  const handleExportConfig = () => {
    try {
      // 构建符合要求的配置格式
      const exportConfig = {
        cache_time: config?.SiteConfig?.SiteInterfaceCacheTime || 7200,
        api_site: {} as Record<string, any>,
      };

      // 将视频源转换为config.json格式
      sources.forEach((source) => {
        if (!source.disabled) {
          exportConfig.api_site[source.key] = {
            api: source.api,
            name: source.name,
            ...(source.detail && { detail: source.detail }),
          };
        }
      });

      // 生成JSON文件并下载
      const dataStr = JSON.stringify(exportConfig, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);

      const link = document.createElement('a');
      link.href = url;
      link.download = `config_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      showSuccess('配置文件已导出到下载文件夹');
    } catch (error) {
      showError(
        '导出失败: ' + (error instanceof Error ? error.message : '未知错误')
      );
    }
  };

  // 导入配置
  const handleImportConfig = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // 检查文件类型
    if (!file.name.toLowerCase().endsWith('.json')) {
      showError('请选择JSON文件');
      return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const content = e.target?.result as string;
        const importConfig = JSON.parse(content);

        // 验证配置格式
        if (
          !importConfig.api_site ||
          typeof importConfig.api_site !== 'object'
        ) {
          showError('配置文件格式错误：缺少 api_site 字段');
          return;
        }

        // 确认导入
        const result = await Swal.fire({
          ...adminDialogAppearance(),
          title: '确认导入',
          text: `检测到 ${
            Object.keys(importConfig.api_site).length
          } 个视频源，是否继续导入？`,
          icon: 'question',
          showCancelButton: true,
          focusCancel: true,
          confirmButtonText: '确认导入',
          cancelButtonText: '取消',
          confirmButtonColor: '#059669',
          cancelButtonColor: '#6b7280',
        });

        if (!result.isConfirmed) return;

        // 批量导入视频源
        let successCount = 0;
        let errorCount = 0;
        const errors: string[] = [];

        for (const [key, source] of Object.entries(importConfig.api_site)) {
          try {
            // 类型检查和验证
            if (
              !source ||
              typeof source !== 'object' ||
              Array.isArray(source)
            ) {
              throw new Error(`${key}: 无效的配置对象`);
            }

            const sourceObj = source as {
              api?: string;
              name?: string;
              detail?: string;
            };

            if (!sourceObj.api || !sourceObj.name) {
              throw new Error(`${key}: 缺少必要字段 api 或 name`);
            }

            await callSourceApi({
              action: 'add',
              key: key,
              name: sourceObj.name,
              api: sourceObj.api,
              detail: sourceObj.detail || '',
            });
            successCount++;
          } catch (error) {
            errorCount++;
            errors.push(
              `${key}: ${error instanceof Error ? error.message : '未知错误'}`
            );
          }
        }

        // 显示导入结果
        if (errorCount === 0) {
          showSuccess(`成功导入 ${successCount} 个视频源`);
        } else {
          await Swal.fire({
            ...adminDialogAppearance(),
            title: '导入完成',
            html: `
              <div class="text-left">
                <p class="text-[rgb(var(--ui-success))] mb-2">✅ 成功导入: ${successCount} 个</p>
                <p class="text-[rgb(var(--ui-critical))] mb-2">❌ 导入失败: ${errorCount} 个</p>
                ${
                  errors.length > 0
                    ? `
                  <details class="mt-3">
                    <summary class="cursor-pointer text-[rgb(var(--ui-text-muted))]">查看错误详情</summary>
                    <div class="mt-2 text-sm text-[rgb(var(--ui-text-muted))] max-h-32 overflow-y-auto">
                      ${errors
                        .map((err) => `<div class="py-1">${err}</div>`)
                        .join('')}
                    </div>
                  </details>
                `
                    : ''
                }
              </div>
            `,
            icon: successCount > 0 ? 'warning' : 'error',
            confirmButtonText: '确定',
          });
        }
      } catch (error) {
        showError(
          '配置文件解析失败: ' +
            (error instanceof Error ? error.message : '文件格式错误')
        );
      }
    };

    reader.onerror = () => {
      showError('文件读取失败');
    };

    reader.readAsText(file);

    // 清空input，允许重复选择同一文件
    event.target.value = '';
  };

  const handleMoveSource = (from: number, to: number) => {
    if (from < 0 || to < 0 || to >= sources.length || from === to) return;
    setSources((prev) => arrayMove(prev, from, to));
    setOrderChanged(true);
  };

  const handleDragEnd = (event: any) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = sources.findIndex((s) => s.key === active.id);
    const newIndex = sources.findIndex((s) => s.key === over.id);
    handleMoveSource(oldIndex, newIndex);
  };

  const handleSaveOrder = () => {
    const order = sources.map((s) => s.key);
    callSourceApi({ action: 'sort', order })
      .then(() => {
        setOrderChanged(false);
      })
      .catch(() => {
        console.error('操作失败', 'sort', order);
      });
  };

  if (!config) {
    return (
      <div className='text-center text-[rgb(var(--ui-text-muted))]'>
        加载中...
      </div>
    );
  }

  return (
    <div className='space-y-6'>
      {/* 视频源管理工具栏 */}
      <div className='flex items-center justify-between flex-wrap gap-3'>
        <h4 className='text-sm font-medium text-[rgb(var(--ui-text))]'>
          视频源列表
        </h4>

        <div className='flex items-center gap-2 flex-wrap'>
          {/* 批量操作区域 */}
          {!batchMode ? (
            <>
              {/* 普通模式按钮 */}
              <button
                onClick={handleToggleBatchMode}
                className='inline-flex items-center px-3 py-1 bg-[rgb(var(--ui-accent))] hover:bg-[rgb(var(--ui-accent))] text-[rgb(var(--ui-on-accent))] text-sm rounded-lg transition-colors'
              >
                ☑️ 批量选择
              </button>

              {/* 导入导出按钮 */}
              <div className='flex items-center gap-1 border-l border-[rgb(var(--ui-border))] pl-2'>
                <label htmlFor='admin-import-sources' className='relative'>
                  <input
                    type='file'
                    id='admin-import-sources'
                    aria-label='导入视频源配置'
                    accept='.json'
                    onChange={handleImportConfig}
                    className='absolute inset-0 w-full h-full opacity-0 cursor-pointer'
                  />
                  <span className='inline-flex items-center px-3 py-1 bg-[rgb(var(--ui-accent))] hover:bg-[rgb(var(--ui-accent))] text-[rgb(var(--ui-on-accent))] text-sm rounded-lg transition-colors cursor-pointer'>
                    导入
                  </span>
                </label>

                <button
                  onClick={handleExportConfig}
                  className='inline-flex items-center px-3 py-1 bg-[rgb(var(--ui-accent))] hover:bg-[rgb(var(--ui-accent))] text-[rgb(var(--ui-on-accent))] text-sm rounded-lg transition-colors'
                >
                  导出
                </button>
              </div>

              {/* 添加视频源按钮 */}
              <button
                onClick={() => setShowAddForm(!showAddForm)}
                className='px-3 py-1 bg-[rgb(var(--ui-accent-warm)/0.12)] hover:bg-[rgb(var(--ui-accent-warm)/0.12)] text-[rgb(var(--ui-accent-warm))] text-sm rounded-lg transition-colors'
              >
                {showAddForm ? '取消' : '添加'}
              </button>
            </>
          ) : (
            <>
              {/* 批量模式按钮 */}
              <button
                onClick={handleToggleBatchMode}
                className='inline-flex items-center px-3 py-1 bg-[rgb(var(--ui-surface-strong))] hover:bg-[rgb(var(--ui-surface-strong))] text-[rgb(var(--ui-text))] text-sm rounded-lg transition-colors'
              >
                退出批量
              </button>

              <div className='flex items-center gap-1 border-l border-[rgb(var(--ui-border))] pl-2'>
                <span className='text-xs text-[rgb(var(--ui-text-muted))]'>
                  已选 {selectedSources.size} 个
                </span>

                <button
                  onClick={handleBatchDelete}
                  disabled={selectedSources.size === 0}
                  className='inline-flex items-center px-3 py-1 bg-[rgb(var(--ui-critical)/0.12)] hover:bg-[rgb(var(--ui-critical)/0.12)] disabled:bg-[rgb(var(--ui-surface-strong))] text-[rgb(var(--ui-critical))] text-sm rounded-lg transition-colors'
                >
                  🗑️ 批量删除
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {showAddForm && (
        <div className='p-4 bg-[rgb(var(--ui-surface))] rounded-lg border border-[rgb(var(--ui-border))] space-y-4'>
          <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
            <input
              type='text'
              aria-label='名称'
              placeholder='名称'
              value={newSource.name}
              onChange={(e) =>
                setNewSource((prev) => ({ ...prev, name: e.target.value }))
              }
              className='px-3 py-2 border border-[rgb(var(--ui-border))] rounded-lg bg-[rgb(var(--ui-surface))] text-[rgb(var(--ui-text))]'
            />
            <input
              type='text'
              aria-label='Key'
              placeholder='Key'
              value={newSource.key}
              onChange={(e) =>
                setNewSource((prev) => ({ ...prev, key: e.target.value }))
              }
              className='px-3 py-2 border border-[rgb(var(--ui-border))] rounded-lg bg-[rgb(var(--ui-surface))] text-[rgb(var(--ui-text))]'
            />
            <input
              type='text'
              aria-label='API 地址'
              placeholder='API 地址'
              value={newSource.api}
              onChange={(e) =>
                setNewSource((prev) => ({ ...prev, api: e.target.value }))
              }
              className='px-3 py-2 border border-[rgb(var(--ui-border))] rounded-lg bg-[rgb(var(--ui-surface))] text-[rgb(var(--ui-text))]'
            />
            <input
              type='text'
              aria-label='Detail 地址（选填）'
              placeholder='Detail 地址（选填）'
              value={newSource.detail}
              onChange={(e) =>
                setNewSource((prev) => ({ ...prev, detail: e.target.value }))
              }
              className='px-3 py-2 border border-[rgb(var(--ui-border))] rounded-lg bg-[rgb(var(--ui-surface))] text-[rgb(var(--ui-text))]'
            />
          </div>
          <div className='flex justify-end'>
            <button
              onClick={handleAddSource}
              disabled={!newSource.name || !newSource.key || !newSource.api}
              className='w-full sm:w-auto px-4 py-2 bg-[rgb(var(--ui-accent))] hover:bg-[rgb(var(--ui-accent))] disabled:bg-[rgb(var(--ui-surface-strong))] text-[rgb(var(--ui-on-accent))] rounded-lg transition-colors'
            >
              添加
            </button>
          </div>
        </div>
      )}

      {/* 视频源表格 */}
      <div
        className='ui-admin-table-region border border-[rgb(var(--ui-border))] rounded-lg max-h-[28rem] overflow-y-auto overflow-x-auto'
        role='region'
        aria-label='管理数据表格，可横向滚动'
        tabIndex={0}
      >
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          autoScroll={false}
          modifiers={[restrictToVerticalAxis, restrictToParentElement]}
        >
          <table className='min-w-full divide-y divide-[rgb(var(--ui-border))]'>
            <thead className='bg-[rgb(var(--ui-surface))]'>
              <tr>
                {/* 拖拽手柄列 */}
                <th className='px-2 py-3 text-left text-xs font-medium text-[rgb(var(--ui-text-muted))]'>
                  排序
                </th>

                {/* 批量选择列 */}
                {batchMode && (
                  <th className='w-12 px-4 py-3'>
                    <input
                      type='checkbox'
                      aria-label='选择全部可管理视频源'
                      checked={
                        selectedSources.size > 0 &&
                        selectedSources.size === sources.length
                      }
                      onChange={(e) => handleSelectAll(e.target.checked)}
                      className='w-4 h-4 text-[rgb(var(--ui-accent))] bg-[rgb(var(--ui-surface))] border-[rgb(var(--ui-border))] rounded focus:ring-[rgb(var(--ui-accent))] focus:ring-2'
                    />
                  </th>
                )}

                <th className='px-6 py-3 text-left text-xs font-medium text-[rgb(var(--ui-text-muted))] uppercase tracking-wider'>
                  名称
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium text-[rgb(var(--ui-text-muted))] uppercase tracking-wider'>
                  Key
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium text-[rgb(var(--ui-text-muted))] uppercase tracking-wider'>
                  API 地址
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium text-[rgb(var(--ui-text-muted))] uppercase tracking-wider'>
                  Detail 地址
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium text-[rgb(var(--ui-text-muted))] uppercase tracking-wider'>
                  状态
                </th>
                <th className='px-6 py-3 text-right text-xs font-medium text-[rgb(var(--ui-text-muted))] uppercase tracking-wider'>
                  操作
                </th>
              </tr>
            </thead>
            <SortableContext
              items={sources.map((s) => s.key)}
              strategy={verticalListSortingStrategy}
            >
              <tbody className='divide-y divide-[rgb(var(--ui-border))]'>
                {sources.map((source, index) => (
                  <DraggableRow
                    key={source.key}
                    source={source}
                    index={index}
                    sourceCount={sources.length}
                    onMove={handleMoveSource}
                    batchMode={batchMode}
                    selectedSources={selectedSources}
                    onSelectSource={handleSelectSource}
                    onToggleEnable={handleToggleEnable}
                    onDelete={handleDelete}
                  />
                ))}
              </tbody>
            </SortableContext>
          </table>
        </DndContext>
      </div>

      {/* 保存排序按钮 */}
      {orderChanged && (
        <div className='flex justify-end'>
          <button
            onClick={handleSaveOrder}
            className='px-3 py-1.5 text-sm bg-[rgb(var(--ui-accent))] hover:bg-[rgb(var(--ui-accent))] text-[rgb(var(--ui-on-accent))] rounded-lg transition-colors'
          >
            保存排序
          </button>
        </div>
      )}
    </div>
  );
};

// 新增站点配置组件
const SiteConfigComponent = ({ config }: { config: AdminConfig | null }) => {
  const [siteSettings, setSiteSettings] = useState<SiteConfig>({
    SiteName: '',
    Announcement: '',
    SearchDownstreamMaxPage: 1,
    SiteInterfaceCacheTime: 7200,
    ImageProxy: '',
    DoubanProxy: '',
    PlaybackDebugEnabled: false,
  });
  // 保存状态
  const [saving, setSaving] = useState(false);

  const storageType = useRuntimeStorageType();
  const isD1Storage = storageType === 'd1';
  const isUpstashStorage = storageType === 'upstash';

  useEffect(() => {
    if (config?.SiteConfig) {
      setSiteSettings({
        ...config.SiteConfig,
        ImageProxy: config.SiteConfig.ImageProxy || '',
        DoubanProxy: config.SiteConfig.DoubanProxy || '',
        PlaybackDebugEnabled: Boolean(config.SiteConfig.PlaybackDebugEnabled),
      });
    }
  }, [config]);

  // 保存站点配置
  const handleSave = async () => {
    try {
      setSaving(true);
      const resp = await fetch('/api/admin/site', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...siteSettings }),
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || `保存失败: ${resp.status}`);
      }

      showSuccess('保存成功, 请刷新页面');
    } catch (err) {
      showError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (!config) {
    return (
      <div className='text-center text-[rgb(var(--ui-text-muted))]'>
        加载中...
      </div>
    );
  }

  return (
    <div className='space-y-6'>
      {/* 站点名称 */}
      <div>
        <label
          htmlFor='admin-site-name'
          className={`block text-sm font-medium text-[rgb(var(--ui-text))]  mb-2 ${
            isD1Storage || isUpstashStorage ? 'opacity-50' : ''
          }`}
        >
          站点名称
          {isD1Storage && (
            <span className='ml-2 text-xs text-[rgb(var(--ui-text-muted))]'>
              (D1 环境下请通过环境变量修改)
            </span>
          )}
          {isUpstashStorage && (
            <span className='ml-2 text-xs text-[rgb(var(--ui-text-muted))]'>
              (Upstash 环境下请通过环境变量修改)
            </span>
          )}
        </label>
        <input
          type='text'
          id='admin-site-name'
          aria-label='站点名称'
          value={siteSettings.SiteName}
          onChange={(e) =>
            !isD1Storage &&
            !isUpstashStorage &&
            setSiteSettings((prev) => ({ ...prev, SiteName: e.target.value }))
          }
          disabled={isD1Storage || isUpstashStorage}
          className={`w-full px-3 py-2 border border-[rgb(var(--ui-border))]  rounded-lg bg-[rgb(var(--ui-surface))]  text-[rgb(var(--ui-text))]  focus:ring-2 focus:ring-[rgb(var(--ui-accent))] focus:border-transparent ${
            isD1Storage || isUpstashStorage
              ? 'opacity-50 cursor-not-allowed'
              : ''
          }`}
        />
      </div>

      {/* 站点公告 */}
      <div>
        <label
          htmlFor='admin-site-announcement'
          className={`block text-sm font-medium text-[rgb(var(--ui-text))]  mb-2 ${
            isD1Storage || isUpstashStorage ? 'opacity-50' : ''
          }`}
        >
          站点公告
          {isD1Storage && (
            <span className='ml-2 text-xs text-[rgb(var(--ui-text-muted))]'>
              (D1 环境下请通过环境变量修改)
            </span>
          )}
          {isUpstashStorage && (
            <span className='ml-2 text-xs text-[rgb(var(--ui-text-muted))]'>
              (Upstash 环境下请通过环境变量修改)
            </span>
          )}
        </label>
        <textarea
          id='admin-site-announcement'
          aria-label='站点公告'
          value={siteSettings.Announcement}
          onChange={(e) =>
            !isD1Storage &&
            !isUpstashStorage &&
            setSiteSettings((prev) => ({
              ...prev,
              Announcement: e.target.value,
            }))
          }
          disabled={isD1Storage || isUpstashStorage}
          rows={3}
          className={`w-full px-3 py-2 border border-[rgb(var(--ui-border))]  rounded-lg bg-[rgb(var(--ui-surface))]  text-[rgb(var(--ui-text))]  focus:ring-2 focus:ring-[rgb(var(--ui-accent))] focus:border-transparent ${
            isD1Storage || isUpstashStorage
              ? 'opacity-50 cursor-not-allowed'
              : ''
          }`}
        />
      </div>

      {/* 搜索接口可拉取最大页数 */}
      <div>
        <label
          htmlFor='admin-search-max-pages'
          className='block text-sm font-medium text-[rgb(var(--ui-text))] mb-2'
        >
          搜索接口可拉取最大页数
        </label>
        <input
          type='number'
          min={1}
          id='admin-search-max-pages'
          aria-label='搜索下游最大页数'
          value={siteSettings.SearchDownstreamMaxPage}
          onChange={(e) =>
            setSiteSettings((prev) => ({
              ...prev,
              SearchDownstreamMaxPage: Number(e.target.value),
            }))
          }
          className='w-full px-3 py-2 border border-[rgb(var(--ui-border))] rounded-lg bg-[rgb(var(--ui-surface))] text-[rgb(var(--ui-text))] focus:ring-2 focus:ring-[rgb(var(--ui-accent))] focus:border-transparent'
        />
      </div>

      {/* 站点接口缓存时间 */}
      <div>
        <label
          htmlFor='admin-site-cache-time'
          className='block text-sm font-medium text-[rgb(var(--ui-text))] mb-2'
        >
          站点接口缓存时间（秒）
        </label>
        <input
          type='number'
          min={1}
          id='admin-site-cache-time'
          aria-label='站点接口缓存时间'
          value={siteSettings.SiteInterfaceCacheTime}
          onChange={(e) =>
            setSiteSettings((prev) => ({
              ...prev,
              SiteInterfaceCacheTime: Number(e.target.value),
            }))
          }
          className='w-full px-3 py-2 border border-[rgb(var(--ui-border))] rounded-lg bg-[rgb(var(--ui-surface))] text-[rgb(var(--ui-text))] focus:ring-2 focus:ring-[rgb(var(--ui-accent))] focus:border-transparent'
        />
      </div>

      {/* 图片代理 */}
      <div>
        <label
          htmlFor='admin-image-proxy'
          className={`block text-sm font-medium text-[rgb(var(--ui-text))]  mb-2 ${
            isD1Storage || isUpstashStorage ? 'opacity-50' : ''
          }`}
        >
          图片代理前缀
          {isD1Storage && (
            <span className='ml-2 text-xs text-[rgb(var(--ui-text-muted))]'>
              (D1 环境下请通过环境变量修改)
            </span>
          )}
          {isUpstashStorage && (
            <span className='ml-2 text-xs text-[rgb(var(--ui-text-muted))]'>
              (Upstash 环境下请通过环境变量修改)
            </span>
          )}
        </label>
        <input
          type='text'
          placeholder='例如: https://imageproxy.example.com/?url='
          id='admin-image-proxy'
          aria-label='图片代理'
          value={siteSettings.ImageProxy}
          onChange={(e) =>
            !isD1Storage &&
            !isUpstashStorage &&
            setSiteSettings((prev) => ({
              ...prev,
              ImageProxy: e.target.value,
            }))
          }
          disabled={isD1Storage || isUpstashStorage}
          className={`w-full px-3 py-2 border border-[rgb(var(--ui-border))]  rounded-lg bg-[rgb(var(--ui-surface))]  text-[rgb(var(--ui-text))]  focus:ring-2 focus:ring-[rgb(var(--ui-accent))] focus:border-transparent ${
            isD1Storage || isUpstashStorage
              ? 'opacity-50 cursor-not-allowed'
              : ''
          }`}
        />
        <p className='mt-1 text-xs text-[rgb(var(--ui-text-muted))]'>
          用于代理图片访问，解决跨域或访问限制问题。留空则不使用代理。
        </p>
      </div>

      {/* 豆瓣代理设置 */}
      <div>
        <label
          htmlFor='admin-douban-proxy'
          className={`block text-sm font-medium text-[rgb(var(--ui-text))]  mb-2 ${
            isD1Storage || isUpstashStorage ? 'opacity-50' : ''
          }`}
        >
          豆瓣代理地址
          {isD1Storage && (
            <span className='ml-2 text-xs text-[rgb(var(--ui-text-muted))]'>
              (D1 环境下请通过环境变量修改)
            </span>
          )}
          {isUpstashStorage && (
            <span className='ml-2 text-xs text-[rgb(var(--ui-text-muted))]'>
              (Upstash 环境下请通过环境变量修改)
            </span>
          )}
        </label>
        <input
          type='text'
          placeholder='例如: https://proxy.example.com/fetch?url='
          id='admin-douban-proxy'
          aria-label='豆瓣代理'
          value={siteSettings.DoubanProxy}
          onChange={(e) =>
            !isD1Storage &&
            !isUpstashStorage &&
            setSiteSettings((prev) => ({
              ...prev,
              DoubanProxy: e.target.value,
            }))
          }
          disabled={isD1Storage || isUpstashStorage}
          className={`w-full px-3 py-2 border border-[rgb(var(--ui-border))]  rounded-lg bg-[rgb(var(--ui-surface))]  text-[rgb(var(--ui-text))]  focus:ring-2 focus:ring-[rgb(var(--ui-accent))] focus:border-transparent ${
            isD1Storage || isUpstashStorage
              ? 'opacity-50 cursor-not-allowed'
              : ''
          }`}
        />
        <p className='mt-1 text-xs text-[rgb(var(--ui-text-muted))]'>
          用于代理豆瓣数据访问，解决跨域或访问限制问题。留空则使用服务端API。
        </p>
      </div>

      {/* 播放调试模式 */}
      <div className='rounded-lg border border-[rgb(var(--ui-accent-warm))] bg-[rgb(var(--ui-accent-warm)/0.1)] p-4'>
        <label
          htmlFor='admin-playback-debug'
          className='flex cursor-pointer items-start gap-3'
        >
          <input
            type='checkbox'
            id='admin-playback-debug'
            checked={Boolean(siteSettings.PlaybackDebugEnabled)}
            onChange={(e) =>
              setSiteSettings((prev) => ({
                ...prev,
                PlaybackDebugEnabled: e.target.checked,
              }))
            }
            className='mt-1 h-4 w-4 rounded border-[rgb(var(--ui-border))] text-[rgb(var(--ui-accent-warm))] focus:ring-[rgb(var(--ui-accent-warm))]'
          />
          <span>
            <span className='block text-sm font-medium text-[rgb(var(--ui-text))]'>
              播放调试模式
            </span>
            <span className='mt-1 block text-xs leading-5 text-[rgb(var(--ui-text-muted))]'>
              开启后，管理员播放页会显示调试面板，并把卡顿、恢复、播放策略等信息写入后台日志表。关闭后不会记录。
            </span>
          </span>
        </label>
      </div>

      {/* 操作按钮 */}
      <div className='flex justify-end'>
        <button
          onClick={handleSave}
          disabled={saving}
          className={`px-4 py-2 ${
            saving
              ? 'bg-[rgb(var(--ui-surface-strong))] cursor-not-allowed'
              : 'bg-[rgb(var(--ui-accent))] hover:bg-[rgb(var(--ui-accent))]'
          } text-[rgb(var(--ui-on-accent))] rounded-lg transition-colors`}
        >
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
    </div>
  );
};

const AiUsageMonitor = () => {
  const [report, setReport] = useState<AiUsageReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchUsage = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch('/api/admin/ai-usage?days=7&limit=20');
      const data = (await response.json().catch(() => ({}))) as
        | AiUsageReport
        | { error?: string; details?: string };

      if (!response.ok) {
        throw new Error(
          'error' in data
            ? data.details || data.error || `获取失败: ${response.status}`
            : `获取失败: ${response.status}`
        );
      }

      setReport(data as AiUsageReport);
    } catch (err) {
      const message = err instanceof Error ? err.message : '获取 AI 用量失败';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsage();
  }, [fetchUsage]);

  const formatTime = (value: number | null) => {
    if (value === null || value === undefined) return '-';
    return new Date(value).toLocaleString('zh-CN', {
      hour12: false,
    });
  };

  const endpointLabel = (endpoint: AiUsageSubject['endpoint']) =>
    endpoint === 'find' ? 'AI 识别' : '结果加载';

  const renderSubjectTable = ({
    title,
    emptyText,
    subjects,
  }: {
    title: string;
    emptyText: string;
    subjects: AiUsageSubject[];
  }) => (
    <div className='space-y-2'>
      <h5 className='text-sm font-medium text-[rgb(var(--ui-text))]'>
        {title}
      </h5>
      <div
        className='ui-admin-table-region border border-[rgb(var(--ui-border))] rounded-lg overflow-x-auto'
        role='region'
        aria-label='管理数据表格，可横向滚动'
        tabIndex={0}
      >
        <table className='min-w-full divide-y divide-[rgb(var(--ui-border))]'>
          <thead className='bg-[rgb(var(--ui-surface))]'>
            <tr>
              <th className='px-4 py-3 text-left text-xs font-medium text-[rgb(var(--ui-text-muted))] uppercase tracking-wider'>
                对象
              </th>
              <th className='px-4 py-3 text-left text-xs font-medium text-[rgb(var(--ui-text-muted))] uppercase tracking-wider'>
                接口
              </th>
              <th className='px-4 py-3 text-right text-xs font-medium text-[rgb(var(--ui-text-muted))] uppercase tracking-wider'>
                今天次数
              </th>
              <th className='px-4 py-3 text-left text-xs font-medium text-[rgb(var(--ui-text-muted))] uppercase tracking-wider'>
                最近更新
              </th>
            </tr>
          </thead>
          <tbody className='divide-y divide-[rgb(var(--ui-border))]'>
            {subjects.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className='px-4 py-6 text-center text-sm text-[rgb(var(--ui-text-muted))]'
                >
                  {emptyText}
                </td>
              </tr>
            ) : (
              subjects.map((item) => (
                <tr key={`${item.scope}:${item.endpoint}:${item.subject}`}>
                  <td className='px-4 py-3 text-sm text-[rgb(var(--ui-text))]'>
                    {item.subject}
                  </td>
                  <td className='px-4 py-3 text-sm text-[rgb(var(--ui-text))]'>
                    {endpointLabel(item.endpoint)}
                  </td>
                  <td className='px-4 py-3 text-sm text-right font-medium text-[rgb(var(--ui-text))]'>
                    {item.count}
                  </td>
                  <td className='px-4 py-3 text-sm text-[rgb(var(--ui-text))]'>
                    {formatTime(item.updatedAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className='space-y-5'>
      <div className='flex items-center justify-between gap-3 flex-wrap'>
        <div>
          <h4 className='text-sm font-medium text-[rgb(var(--ui-text))]'>
            AI 找片用量
          </h4>
          <p className='mt-1 text-xs text-[rgb(var(--ui-text-muted))]'>
            这里展示每日调用量和今天占用最高的用户或 IP。
          </p>
        </div>
        <button
          onClick={fetchUsage}
          disabled={loading}
          className='px-3 py-1.5 text-sm bg-[rgb(var(--ui-accent))] hover:bg-[rgb(var(--ui-accent))] disabled:bg-[rgb(var(--ui-surface-strong))] text-[rgb(var(--ui-on-accent))] rounded-lg transition-colors'
        >
          {loading ? '刷新中…' : '刷新'}
        </button>
      </div>

      {error && (
        <div className='rounded-lg border border-[rgb(var(--ui-critical))] bg-[rgb(var(--ui-critical)/0.1)] px-4 py-3 text-sm text-[rgb(var(--ui-critical))]'>
          {error}
        </div>
      )}

      {!report && !error && (
        <div className='text-sm text-[rgb(var(--ui-text-muted))]'>
          {loading ? '正在读取 AI 用量...' : '暂无用量数据'}
        </div>
      )}

      {report && (
        <>
          <div className='grid grid-cols-1 sm:grid-cols-3 gap-3'>
            <div className='rounded-lg border border-[rgb(var(--ui-border))] p-4'>
              <div className='text-xs text-[rgb(var(--ui-text-muted))]'>
                今天 AI 识别
              </div>
              <div className='mt-2 text-2xl font-semibold text-[rgb(var(--ui-text))]'>
                {report.today.find.total}
              </div>
            </div>
            <div className='rounded-lg border border-[rgb(var(--ui-border))] p-4'>
              <div className='text-xs text-[rgb(var(--ui-text-muted))]'>
                今天结果加载
              </div>
              <div className='mt-2 text-2xl font-semibold text-[rgb(var(--ui-text))]'>
                {report.today.group.total}
              </div>
            </div>
            <div className='rounded-lg border border-[rgb(var(--ui-border))] p-4'>
              <div className='text-xs text-[rgb(var(--ui-text-muted))]'>
                更新时间
              </div>
              <div className='mt-2 text-sm font-medium text-[rgb(var(--ui-text))]'>
                {formatTime(report.generatedAt)}
              </div>
            </div>
          </div>

          <div
            className='ui-admin-table-region border border-[rgb(var(--ui-border))] rounded-lg overflow-x-auto'
            role='region'
            aria-label='管理数据表格，可横向滚动'
            tabIndex={0}
          >
            <table className='min-w-full divide-y divide-[rgb(var(--ui-border))]'>
              <thead className='bg-[rgb(var(--ui-surface))]'>
                <tr>
                  <th className='px-4 py-3 text-left text-xs font-medium text-[rgb(var(--ui-text-muted))] uppercase tracking-wider'>
                    日期
                  </th>
                  <th className='px-4 py-3 text-right text-xs font-medium text-[rgb(var(--ui-text-muted))] uppercase tracking-wider'>
                    AI 识别
                  </th>
                  <th className='px-4 py-3 text-right text-xs font-medium text-[rgb(var(--ui-text-muted))] uppercase tracking-wider'>
                    结果加载
                  </th>
                  <th className='px-4 py-3 text-right text-xs font-medium text-[rgb(var(--ui-text-muted))] uppercase tracking-wider'>
                    合计
                  </th>
                </tr>
              </thead>
              <tbody className='divide-y divide-[rgb(var(--ui-border))]'>
                {report.days.map((day) => (
                  <tr key={day.dayKey}>
                    <td className='px-4 py-3 text-sm text-[rgb(var(--ui-text))]'>
                      {day.dayKey}
                    </td>
                    <td className='px-4 py-3 text-sm text-right text-[rgb(var(--ui-text))]'>
                      {day.find}
                    </td>
                    <td className='px-4 py-3 text-sm text-right text-[rgb(var(--ui-text))]'>
                      {day.group}
                    </td>
                    <td className='px-4 py-3 text-sm text-right font-medium text-[rgb(var(--ui-text))]'>
                      {day.total}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className='grid grid-cols-1 xl:grid-cols-2 gap-4'>
            {renderSubjectTable({
              title: '用户用量排行',
              emptyText: '今天还没有用户用量记录',
              subjects: report.topUsers || [],
            })}
            {renderSubjectTable({
              title: 'IP 用量排行',
              emptyText: '今天还没有 IP 用量记录',
              subjects: report.topIps || [],
            })}
          </div>
        </>
      )}
    </div>
  );
};

const formatDebugTime = (value: number | null) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '-';
  }
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60)
    .toString()
    .padStart(2, '0');
  return `${minutes}:${seconds}`;
};

const formatCreatedAt = (value: number) => {
  if (!value) {
    return '-';
  }
  return new Date(value).toLocaleString('zh-CN', {
    hour12: false,
  });
};

const stringifyDebugDetails = (details: unknown) => {
  if (details == null) {
    return '';
  }
  if (typeof details === 'string') {
    return details;
  }
  try {
    return JSON.stringify(details);
  } catch {
    return String(details);
  }
};

const formatPlaybackDebugLogsForExport = (
  logs: PlaybackDebugLogEntry[],
  enabled: boolean | undefined
) => {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      enabled: Boolean(enabled),
      count: logs.length,
      logs,
    },
    null,
    2
  );
};

const PlaybackDebugLogs = () => {
  const [data, setData] = useState<PlaybackDebugLogResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch('/api/admin/playback-debug?limit=100');
      const payload = (await response.json().catch(() => ({}))) as
        | PlaybackDebugLogResponse
        | { error?: string };
      if (!response.ok) {
        throw new Error(
          'error' in payload && payload.error
            ? payload.error
            : `读取失败: ${response.status}`
        );
      }
      setData(payload as PlaybackDebugLogResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取播放调试日志失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchLogs();
  }, [fetchLogs]);

  const logs = data?.logs || [];

  const handleCopyLogs = async () => {
    if (logs.length === 0 || copying) {
      return;
    }

    try {
      setCopying(true);
      const text = formatPlaybackDebugLogsForExport(logs, data?.enabled);
      await navigator.clipboard.writeText(text);
      showSuccess(`已复制 ${logs.length} 条播放调试日志`);
    } catch (err) {
      showError(err instanceof Error ? err.message : '复制日志失败');
    } finally {
      setCopying(false);
    }
  };

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div>
          <p className='text-sm text-[rgb(var(--ui-text-muted))]'>
            当前状态：
            <span
              className={`ml-1 font-medium ${
                data?.enabled
                  ? 'text-[rgb(var(--ui-success))] '
                  : 'text-[rgb(var(--ui-text-muted))] '
              }`}
            >
              {data?.enabled ? '已开启' : '未开启'}
            </span>
          </p>
          <p className='mt-1 text-xs text-[rgb(var(--ui-text-muted))]'>
            这里只展示最近 100 条管理员播放调试日志。
          </p>
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          <button
            type='button'
            onClick={() => void handleCopyLogs()}
            disabled={loading || copying || logs.length === 0}
            className='rounded-md border border-[rgb(var(--ui-border))] bg-[rgb(var(--ui-surface))] px-4 py-2 text-sm font-medium text-[rgb(var(--ui-text))] transition-colors hover:bg-[rgb(var(--ui-surface))] disabled:cursor-not-allowed disabled:opacity-50'
          >
            {copying ? '复制中…' : '复制日志'}
          </button>
          <button
            type='button'
            onClick={() => void fetchLogs()}
            disabled={loading}
            className='rounded-md bg-[rgb(var(--ui-accent))] px-4 py-2 text-sm font-medium text-[rgb(var(--ui-on-accent))] transition-colors hover:bg-[rgb(var(--ui-accent))] disabled:cursor-not-allowed disabled:bg-[rgb(var(--ui-surface-strong))]'
          >
            {loading ? '读取中…' : '刷新日志'}
          </button>
        </div>
      </div>

      {error && (
        <div className='rounded-lg border border-[rgb(var(--ui-critical))] bg-[rgb(var(--ui-critical)/0.1)] p-3 text-sm text-[rgb(var(--ui-critical))]'>
          {error}
        </div>
      )}

      {!loading && logs.length === 0 && (
        <div className='rounded-lg border border-[rgb(var(--ui-border))] bg-[rgb(var(--ui-surface))] p-6 text-center text-sm text-[rgb(var(--ui-text-muted))]'>
          暂无播放调试日志
        </div>
      )}

      {logs.length > 0 && (
        <div
          className='ui-admin-table-region overflow-x-auto rounded-lg border border-[rgb(var(--ui-border))]'
          role='region'
          aria-label='管理数据表格，可横向滚动'
          tabIndex={0}
        >
          <table className='min-w-full divide-y divide-[rgb(var(--ui-border))] text-sm'>
            <thead className='bg-[rgb(var(--ui-surface))]'>
              <tr>
                <th className='px-3 py-2 text-left font-medium text-[rgb(var(--ui-text-muted))]'>
                  时间
                </th>
                <th className='px-3 py-2 text-left font-medium text-[rgb(var(--ui-text-muted))]'>
                  事件
                </th>
                <th className='px-3 py-2 text-left font-medium text-[rgb(var(--ui-text-muted))]'>
                  播放位置
                </th>
                <th className='px-3 py-2 text-left font-medium text-[rgb(var(--ui-text-muted))]'>
                  影片/来源
                </th>
                <th className='px-3 py-2 text-left font-medium text-[rgb(var(--ui-text-muted))]'>
                  策略
                </th>
                <th className='px-3 py-2 text-left font-medium text-[rgb(var(--ui-text-muted))]'>
                  详情
                </th>
              </tr>
            </thead>
            <tbody className='divide-y divide-[rgb(var(--ui-border))] bg-[rgb(var(--ui-surface))]'>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td className='whitespace-nowrap px-3 py-2 text-[rgb(var(--ui-text))]'>
                    {formatCreatedAt(log.createdAt)}
                  </td>
                  <td className='whitespace-nowrap px-3 py-2 font-medium text-[rgb(var(--ui-text))]'>
                    {log.eventType}
                  </td>
                  <td className='whitespace-nowrap px-3 py-2 text-[rgb(var(--ui-text))]'>
                    {formatDebugTime(log.currentTime)}
                  </td>
                  <td className='min-w-[180px] px-3 py-2 text-[rgb(var(--ui-text))]'>
                    <div>{log.title || '-'}</div>
                    <div className='text-xs text-[rgb(var(--ui-text-muted))]'>
                      {log.sourceKey || log.playbackDomain || '-'}
                    </div>
                  </td>
                  <td className='min-w-[180px] px-3 py-2 text-xs text-[rgb(var(--ui-text-muted))]'>
                    <div>运行时：{log.runtime || '-'}</div>
                    <div>过滤：{log.playlistFilter || '-'}</div>
                    <div>分片：{log.segmentMode || '-'}</div>
                  </td>
                  <td className='max-w-[360px] px-3 py-2 text-xs text-[rgb(var(--ui-text-muted))]'>
                    <div className='line-clamp-3 break-all'>
                      {stringifyDebugDetails(log.details) || '-'}
                    </div>
                    {log.userAgent && (
                      <div className='mt-1 line-clamp-2 break-all text-[rgb(var(--ui-text-muted))]'>
                        {log.userAgent}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

function AdminPageClient() {
  const searchParams = useSearchParams();
  const tvMode = isTvMode(searchParams);
  const requestedSection = searchParams.get('section');
  const section = managementSettingsGroups
    .flatMap((group) => group.items.map((item) => item.id))
    .find((id) => id === requestedSection);
  const modeHref = section ? `/admin?section=${section}` : '/admin';
  const [config, setConfig] = useState<AdminConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<'owner' | 'admin' | null>(null);
  const [expandedTabs, setExpandedTabs] = useState<{ [key: string]: boolean }>({
    userConfig: false,
    inviteConfig: false,
    videoSource: false,
    siteConfig: false,
    aiUsage: false,
    playbackDebug: false,
  });

  useEffect(() => {
    if (section) {
      setExpandedTabs((prev) => ({ ...prev, [section]: true }));
    }
  }, [section]);

  // 获取管理员配置
  // showLoading 用于控制是否在请求期间显示整体加载骨架。
  const fetchConfig = useCallback(async (showLoading = false) => {
    try {
      if (showLoading) {
        setLoading(true);
      }

      const response = await fetch(`/api/admin/config`);

      if (!response.ok) {
        const data = (await response.json()) as any;
        throw new Error(`获取配置失败: ${data.error}`);
      }

      const data = (await response.json()) as AdminConfigResult;
      setConfig(data.Config);
      setRole(data.Role);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '获取配置失败';
      showError(msg);
      setError(msg);
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    // 首次加载时显示骨架
    fetchConfig(true);
  }, [fetchConfig]);

  // 切换标签展开状态
  const toggleTab = (tabKey: string) => {
    setExpandedTabs((prev) => ({
      ...prev,
      [tabKey]: !prev[tabKey],
    }));
  };

  // 新增: 重置配置处理函数
  const handleResetConfig = async () => {
    const { isConfirmed } = await Swal.fire({
      ...adminDialogAppearance(),
      title: '确认重置配置',
      text: '此操作将重置用户封禁和管理员设置、自定义视频源，站点配置将重置为默认值，是否继续？',
      icon: 'warning',
      showCancelButton: true,
      focusCancel: true,
      confirmButtonText: '确认',
      cancelButtonText: '取消',
    });
    if (!isConfirmed) return;

    try {
      const response = await fetch(`/api/admin/reset`);
      if (!response.ok) {
        throw new Error(`重置失败: ${response.status}`);
      }
      showSuccess('重置成功，请刷新页面！');
    } catch (err) {
      showError(err instanceof Error ? err.message : '重置失败');
    }
  };

  if (loading) {
    return (
      <PageLayout activePath='/admin' tvMode={tvMode} modeHref={modeHref}>
        <div className='ui-admin-page' data-tv-mode={tvMode || undefined}>
          <div className='ui-admin-layout'>
            <h1 className='ui-admin-title'>站点管理</h1>
            <div className='space-y-4'>
              {Array.from({ length: 3 }).map((_, index) => (
                <div
                  key={index}
                  className='h-20 bg-[rgb(var(--ui-surface-strong))] rounded-lg animate-pulse'
                />
              ))}
            </div>
          </div>
        </div>
      </PageLayout>
    );
  }

  if (error) {
    return (
      <PageLayout activePath='/admin' tvMode={tvMode} modeHref={modeHref}>
        <div className='ui-admin-page' data-tv-mode={tvMode || undefined}>
          <h1 className='ui-admin-title'>站点管理</h1>
          <div className='ui-admin-section-body' role='alert'>
            <p>管理配置加载失败</p>
            <p className='text-[rgb(var(--ui-text-muted))]'>{error}</p>
            <button
              className='ui-admin-sort-button mt-4'
              onClick={() => {
                setError(null);
                fetchConfig(true);
              }}
            >
              重新加载
            </button>
          </div>
        </div>
      </PageLayout>
    );
  }

  const panels = {
    siteConfig: {
      icon: <Settings size={20} className='text-[rgb(var(--ui-text-muted))]' />,
      content: <SiteConfigComponent config={config} />,
    },
    videoSource: {
      icon: <Video size={20} className='text-[rgb(var(--ui-text-muted))]' />,
      content: (
        <VideoSourceConfig config={config} refreshConfig={fetchConfig} />
      ),
    },
    userConfig: {
      icon: <Users size={20} className='text-[rgb(var(--ui-text-muted))]' />,
      content: (
        <UserConfig config={config} role={role} refreshConfig={fetchConfig} />
      ),
    },
    inviteConfig: {
      icon: <Copy size={20} className='text-[rgb(var(--ui-text-muted))]' />,
      content: <InviteConfig />,
    },
    aiUsage: {
      icon: <Activity size={20} className='text-[rgb(var(--ui-text-muted))]' />,
      content: <AiUsageMonitor />,
    },
    playbackDebug: {
      icon: <Activity size={20} className='text-[rgb(var(--ui-text-muted))]' />,
      content: <PlaybackDebugLogs />,
    },
  };

  return (
    <PageLayout activePath='/admin' tvMode={tvMode} modeHref={modeHref}>
      <div className='ui-admin-page' data-tv-mode={tvMode || undefined}>
        <div className='ui-admin-layout'>
          {/* 标题 + 重置配置按钮 */}
          <div className='ui-admin-heading'>
            <h1 className='ui-admin-title'>站点管理</h1>
            {config && role === 'owner' && (
              <button
                onClick={handleResetConfig}
                className='px-3 py-1 bg-[rgb(var(--ui-critical)/0.12)] hover:bg-[rgb(var(--ui-critical)/0.12)] text-[rgb(var(--ui-critical))] text-xs rounded-md transition-colors'
              >
                重置配置
              </button>
            )}
          </div>

          <nav className='ui-admin-nav' aria-label='管理分类'>
            {managementSettingsGroups.map((group) => (
              <div className='ui-admin-nav-group' key={group.id}>
                <p className='ui-admin-nav-group-title'>{group.label}</p>
                {group.items.map((item) => (
                  <a
                    key={item.id}
                    href={`#admin-${item.id}`}
                    data-active={expandedTabs[item.id] || undefined}
                    onClick={() =>
                      setExpandedTabs((prev) => ({ ...prev, [item.id]: true }))
                    }
                  >
                    {item.label}
                  </a>
                ))}
              </div>
            ))}
          </nav>
          <div className='ui-admin-content'>
            {managementSettingsGroups.map((group) => (
              <section
                key={group.id}
                className='ui-admin-content-group'
                aria-labelledby={`admin-group-${group.id}`}
              >
                <h2
                  id={`admin-group-${group.id}`}
                  className='ui-admin-group-title'
                >
                  {group.label}
                </h2>
                {group.items.map((item) => {
                  const panel = panels[item.id];
                  return (
                    <CollapsibleTab
                      key={item.id}
                      id={item.id}
                      title={item.label}
                      icon={panel.icon}
                      isExpanded={expandedTabs[item.id]}
                      onToggle={() => toggleTab(item.id)}
                    >
                      {panel.content}
                    </CollapsibleTab>
                  );
                })}
              </section>
            ))}
          </div>
        </div>
      </div>
    </PageLayout>
  );
}

export default function AdminPage() {
  return (
    <Suspense>
      <AdminPageClient />
    </Suspense>
  );
}
