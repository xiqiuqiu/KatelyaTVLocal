'use client';

import type { SearchResult } from '@/lib/types';
import { processImageUrl } from '@/lib/utils';

import Surface from '@/components/ui/Surface';

interface PlayDetailSectionProps {
  title: string;
  year?: string | null;
  cover?: string | null;
  detail: Pick<
    SearchResult,
    'class' | 'year' | 'source_name' | 'type_name' | 'desc'
  > | null;
}

function buildMetadataParts(
  detail: PlayDetailSectionProps['detail'],
  year?: string | null
): string[] {
  const parts: string[] = [];
  const resolvedYear = detail?.year || year;
  if (resolvedYear && resolvedYear !== 'unknown') {
    parts.push(resolvedYear);
  }
  if (detail?.type_name?.trim()) {
    parts.push(detail.type_name.trim());
  } else if (detail?.class?.trim()) {
    parts.push(detail.class.trim());
  }
  if (detail?.source_name?.trim()) {
    parts.push(detail.source_name.trim());
  }
  return parts;
}

/**
 * Design Direction lower-detail composition: poster + title + metadata + synopsis.
 * Uses existing SearchResult fields only — no rating API.
 */
export default function PlayDetailSection({
  title,
  year,
  cover,
  detail,
}: PlayDetailSectionProps) {
  const displayTitle = title || '影片标题';
  const posterSrc = cover ? processImageUrl(cover) : '';
  const metadataParts = buildMetadataParts(detail, year);
  const typeLabel = detail?.type_name?.trim() || null;
  // Only show class as a separate genre chip when type_name already occupies the type slot.
  const genreLabel =
    typeLabel && detail?.class?.trim() && detail.class.trim() !== typeLabel
      ? detail.class.trim()
      : null;

  return (
    <section aria-label='影片详情'>
      <Surface
        variant='raised'
        className='grid grid-cols-1 gap-5 overflow-hidden p-4 sm:gap-6 sm:p-5 md:grid-cols-[160px_minmax(0,1fr)] lg:grid-cols-[180px_minmax(0,1fr)]'
      >
        <div className='mx-auto w-36 sm:w-40 md:mx-0 md:w-full'>
          <div className='flex aspect-[2/3] items-center justify-center overflow-hidden rounded-ui-md bg-[rgb(var(--ui-surface))] shadow-ui-soft'>
            {posterSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={posterSrc}
                alt={displayTitle}
                className='h-full w-full object-cover'
              />
            ) : (
              <span className='text-sm text-[rgb(var(--ui-text-muted))]'>
                封面图片
              </span>
            )}
          </div>
        </div>

        <div className='flex min-w-0 flex-col gap-3 sm:gap-4'>
          <div className='space-y-2'>
            <h2 className='text-2xl font-semibold tracking-tight text-[rgb(var(--ui-text))] sm:text-3xl'>
              {displayTitle}
            </h2>

            <div className='flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[rgb(var(--ui-text-muted))] sm:text-base'>
              {genreLabel ? (
                <span className='font-medium text-[rgb(var(--ui-success))]'>
                  {genreLabel}
                </span>
              ) : null}
              {metadataParts.map((part) => (
                <span key={part}>{part}</span>
              ))}
            </div>
          </div>

          {detail?.desc ? (
            <div className='space-y-2'>
              <p className='text-xs font-semibold uppercase tracking-[0.16em] text-[rgb(var(--ui-text-muted))]'>
                简介
              </p>
              <div
                className='max-h-48 overflow-y-auto text-sm leading-relaxed text-[rgb(var(--ui-text)/0.92)] scrollbar-hide sm:text-base'
                style={{ whiteSpace: 'pre-line' }}
              >
                {detail.desc}
              </div>
            </div>
          ) : null}
        </div>
      </Surface>
    </section>
  );
}
