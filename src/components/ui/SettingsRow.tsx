'use client';

import { type LucideIcon, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

interface SettingsRowProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: LucideIcon;
  control?: ReactNode;
  href?: string;
  onClick?: () => void;
  danger?: boolean;
  className?: string;
}

/**
 * 设置面板共用的行结构：左侧图标 + 标题/说明，右侧控件或箭头。
 * href 渲染为链接行，onClick 渲染为按钮行，否则是普通信息行。
 */
export default function SettingsRow({
  title,
  description,
  icon: Icon,
  control,
  href,
  onClick,
  danger = false,
  className = '',
}: SettingsRowProps) {
  const baseClass = `ui-settings-row ${
    danger ? 'ui-settings-row-danger' : ''
  } ${href || onClick ? 'ui-settings-row-action' : ''} ${className}`.trim();

  const content = (
    <>
      {Icon ? (
        <span className='ui-settings-row-icon' aria-hidden='true'>
          <Icon className='h-4 w-4' />
        </span>
      ) : null}
      <span className='ui-settings-row-copy'>
        <span className='ui-settings-row-title'>{title}</span>
        {description ? (
          <span className='ui-settings-row-desc'>{description}</span>
        ) : null}
      </span>
      {control ? (
        <span className='ui-settings-row-control'>{control}</span>
      ) : href || onClick ? (
        <ChevronRight
          className='ui-settings-chevron h-4 w-4'
          aria-hidden='true'
        />
      ) : null}
    </>
  );

  const accessibleLabel = typeof title === 'string' ? title : undefined;

  if (href) {
    return (
      <Link aria-label={accessibleLabel} className={baseClass} href={href}>
        {content}
      </Link>
    );
  }

  if (onClick) {
    return (
      <button
        aria-label={accessibleLabel}
        className={baseClass}
        onClick={onClick}
        type='button'
      >
        {content}
      </button>
    );
  }

  return <div className={baseClass}>{content}</div>;
}
