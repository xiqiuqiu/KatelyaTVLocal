'use client';

import { Check, Clipboard, FileJson, Link2, MonitorPlay } from 'lucide-react';
import { useCallback, useState } from 'react';

import PageLayout from '@/components/PageLayout';
import PageHeader from '@/components/ui/PageHeader';
import Surface from '@/components/ui/Surface';

export const dynamic = 'force-dynamic';
export const runtime = 'edge';

export default function ConfigPage() {
  const [copied, setCopied] = useState(false);
  const [format, setFormat] = useState<'json' | 'base64'>('json');

  const getConfigUrl = useCallback(() => {
    if (typeof window === 'undefined') return '';
    const baseUrl = window.location.origin;
    return `${baseUrl}/api/tvbox?format=${format}`;
  }, [format]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(getConfigUrl());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Copy failed silently
    }
  };

  return (
    <PageLayout activePath='/config'>
      <div className='mx-auto max-w-5xl space-y-6 sm:px-8 sm:py-6 lg:px-12 lg:py-8'>
        <PageHeader
          subtitle='复制配置链接，在 TVBox 中接入当前站点的视频聚合能力'
          title='TVBox 配置'
        />

        <Surface className='p-5 sm:p-6' variant='frosted'>
          <div className='mb-5 flex items-center gap-3'>
            <div className='flex h-11 w-11 items-center justify-center rounded-ui-sm border border-[rgb(var(--ui-border)/0.58)] bg-[rgb(var(--ui-surface)/0.42)] text-[rgb(var(--ui-accent))]'>
              <Link2 className='h-5 w-5' />
            </div>
            <div>
              <h2 className='text-xl font-semibold text-[rgb(var(--ui-text))]'>
                配置链接
              </h2>
              <p className='mt-1 text-sm text-[rgb(var(--ui-text-muted))]'>
                根据播放器支持情况选择 JSON 或 Base64
              </p>
            </div>
          </div>

          <div className='grid gap-4 md:grid-cols-[14rem_1fr]'>
            <label className='block'>
              <span className='mb-2 block text-sm font-medium text-[rgb(var(--ui-text-muted))]'>
                格式类型
              </span>
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value as 'json' | 'base64')}
                className='w-full rounded-ui-sm border border-[rgb(var(--ui-border)/0.62)] bg-[rgb(var(--ui-bg-elevated)/0.74)] px-3 py-3 text-[rgb(var(--ui-text))] shadow-ui-soft focus:border-[rgb(var(--ui-accent))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--ui-accent)/0.32)]'
              >
                <option value='json'>JSON 格式</option>
                <option value='base64'>Base64 格式</option>
              </select>
            </label>

            <div>
              <span className='mb-2 block text-sm font-medium text-[rgb(var(--ui-text-muted))]'>
                当前链接
              </span>
              <div className='flex flex-col gap-3 sm:flex-row'>
                <input
                  type='text'
                  readOnly
                  value={getConfigUrl()}
                  className='min-w-0 flex-1 rounded-ui-sm border border-[rgb(var(--ui-border)/0.62)] bg-[rgb(var(--ui-bg-elevated)/0.74)] px-4 py-3 font-mono text-sm text-[rgb(var(--ui-text))] shadow-ui-soft focus:border-[rgb(var(--ui-accent))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--ui-accent)/0.32)]'
                />
                <button
                  onClick={handleCopy}
                  className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-ui-sm px-5 font-semibold text-[rgb(var(--ui-on-accent))] shadow-ui-soft transition hover:scale-[1.02] ${
                    copied
                      ? 'bg-[rgb(var(--ui-success))]'
                      : 'bg-[rgb(var(--ui-accent))] hover:brightness-110'
                  }`}
                  type='button'
                >
                  {copied ? (
                    <>
                      <Check className='h-4 w-4' />
                      已复制
                    </>
                  ) : (
                    <>
                      <Clipboard className='h-4 w-4' />
                      复制
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </Surface>

        <div className='grid gap-6 lg:grid-cols-[1.1fr_0.9fr]'>
          <Surface className='p-5 sm:p-6' variant='raised'>
            <div className='mb-5 flex items-center gap-3'>
              <FileJson className='h-5 w-5 text-[rgb(var(--ui-accent-warm))]' />
              <h2 className='text-xl font-semibold text-[rgb(var(--ui-text))]'>
                使用说明
              </h2>
            </div>
            <div className='space-y-4 text-sm leading-6 text-[rgb(var(--ui-text-muted))]'>
              {[
                ['获取配置链接', '复制上方配置链接，支持 JSON 和 Base64 两种格式。'],
                ['导入 TVBox', '打开 TVBox 应用，在配置管理中添加新的接口配置。'],
                ['开始使用', '配置导入成功后，即可浏览和观看本站的视频内容。'],
              ].map(([title, desc], index) => (
                <div
                  key={title}
                  className='rounded-ui-sm border border-[rgb(var(--ui-border)/0.3)] bg-[rgb(var(--ui-surface)/0.22)] p-4'
                >
                  <h3 className='font-semibold text-[rgb(var(--ui-text))]'>
                    {index + 1}. {title}
                  </h3>
                  <p className='mt-1'>{desc}</p>
                </div>
              ))}
            </div>
          </Surface>

          <Surface className='p-5 sm:p-6' variant='raised'>
            <div className='mb-5 flex items-center gap-3'>
              <MonitorPlay className='h-5 w-5 text-[rgb(var(--ui-success))]' />
              <h2 className='text-xl font-semibold text-[rgb(var(--ui-text))]'>
                支持功能
              </h2>
            </div>
            <div className='grid gap-4 text-sm text-[rgb(var(--ui-text-muted))]'>
              {[
                ['视频解析', '多源聚合、自动解析、高清播放'],
                ['兼容性', '兼容 TVBox、自定义配置、实时更新内容'],
              ].map(([title, desc]) => (
                <div
                  key={title}
                  className='rounded-ui-sm border border-[rgb(var(--ui-border)/0.3)] bg-[rgb(var(--ui-surface)/0.22)] p-4'
                >
                  <h3 className='font-semibold text-[rgb(var(--ui-text))]'>
                    {title}
                  </h3>
                  <p className='mt-1 leading-6'>{desc}</p>
                </div>
              ))}
            </div>
          </Surface>
        </div>
      </div>
    </PageLayout>
  );
}
