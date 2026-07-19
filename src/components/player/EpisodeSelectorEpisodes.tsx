'use client';

import React, { useEffect, useRef } from 'react';

interface EpisodeSelectorEpisodesProps {
  totalEpisodes: number;
  episodesPerPage: number;
  pageCount: number;
  value: number;
  currentPage: number;
  descending: boolean;
  onCategoryClick: (index: number) => void;
  onToggleDescending: () => void;
  onEpisodeClick: (episodeNumber: number) => void;
}

const stateActiveClass =
  'border-[rgb(var(--ui-accent))] bg-[rgba(var(--ui-accent),0.1)] text-[rgb(var(--ui-text))] shadow-[inset_0_1px_0_rgba(var(--ui-text),0.08),0_8px_20px_rgba(0,0,0,0.18)]';
const stateIdleClass =
  'border-[rgb(var(--ui-border))] bg-[rgb(var(--ui-surface))] text-[rgb(var(--ui-text-muted))] hover:border-[rgba(var(--ui-accent),0.45)] hover:bg-[rgba(var(--ui-surface-strong),0.82)] hover:text-[rgb(var(--ui-text))]';
const currentChipClass =
  'rounded-full bg-[rgb(var(--ui-border))] px-1.5 py-0.5 text-[9px] font-bold leading-none text-[rgb(var(--ui-text))] ring-1 ring-[rgba(var(--ui-text),0.1)]';

function buildCategories(
  pageCount: number,
  episodesPerPage: number,
  totalEpisodes: number
): string[] {
  return Array.from({ length: pageCount }, (_, i) => {
    const start = i * episodesPerPage + 1;
    const end = Math.min(start + episodesPerPage - 1, totalEpisodes);

    if (start === end) {
      return `${start}`;
    }
    if (start >= 1000 || end >= 1000) {
      const formatNumber = (num: number) => {
        if (num >= 1000) {
          return `${Math.floor(num / 100) / 10}k`;
        }
        return num.toString();
      };
      return `${formatNumber(start)}-${formatNumber(end)}`;
    }
    return `${start}-${end}`;
  });
}

const EpisodeSelectorEpisodes: React.FC<EpisodeSelectorEpisodesProps> = ({
  totalEpisodes,
  episodesPerPage,
  pageCount,
  value,
  currentPage,
  descending,
  onCategoryClick,
  onToggleDescending,
  onEpisodeClick,
}) => {
  const categoryContainerRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const categories = buildCategories(pageCount, episodesPerPage, totalEpisodes);

  const currentStart = currentPage * episodesPerPage + 1;
  const currentEnd = Math.min(
    currentStart + episodesPerPage - 1,
    totalEpisodes
  );

  useEffect(() => {
    if (categoryContainerRef.current && buttonRefs.current[currentPage]) {
      const container = categoryContainerRef.current;
      const button = buttonRefs.current[currentPage];

      if (button) {
        const containerRect = container.getBoundingClientRect();
        const buttonRect = button.getBoundingClientRect();
        const scrollLeft = container.scrollLeft;

        if (buttonRect.left < containerRect.left) {
          container.scrollTo({
            left: scrollLeft - (containerRect.left - buttonRect.left) - 20,
            behavior: 'smooth',
          });
        } else if (buttonRect.right > containerRect.right) {
          container.scrollTo({
            left: scrollLeft + (buttonRect.right - containerRect.right) + 20,
            behavior: 'smooth',
          });
        }
      }
    }
  }, [currentPage]);

  const len = currentEnd - currentStart + 1;
  const episodes = Array.from({ length: len }, (_, i) =>
    descending ? currentEnd - i : currentStart + i
  );

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <div className='mb-3 flex flex-shrink-0 items-center gap-2'>
        <div className='relative min-w-0 flex-1 overflow-hidden rounded-ui-md border border-[rgb(var(--ui-border))] bg-[rgb(var(--ui-bg-elevated))]'>
          <div
            className='snap-x snap-mandatory overflow-x-auto overflow-y-hidden scroll-smooth scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/20 hover:scrollbar-thumb-white/35 [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/20 hover:[&::-webkit-scrollbar-thumb]:bg-white/35 [&::-webkit-scrollbar-track]:bg-transparent'
            ref={categoryContainerRef}
            style={{
              scrollbarWidth: 'thin',
              scrollbarColor: 'rgba(255,255,255,0.24) transparent',
              msOverflowStyle: 'none',
              WebkitOverflowScrolling: 'touch',
            }}
          >
            <div className='flex min-w-max gap-1.5 px-1.5 py-1.5'>
              {categories.map((label, idx) => {
                const isActive = idx === currentPage;
                const getButtonWidth = (text: string) => {
                  if (text.length <= 2) return 'w-12';
                  if (text.length <= 5) return 'w-16';
                  if (text.length <= 8) return 'w-20';
                  if (text.length <= 11) return 'w-24';
                  return 'w-28';
                };

                const buttonWidth = isActive
                  ? 'min-w-[78px]'
                  : getButtonWidth(label);

                return (
                  <button
                    key={label}
                    ref={(el) => {
                      buttonRefs.current[idx] = el;
                    }}
                    onClick={() => onCategoryClick(idx)}
                    aria-current={isActive ? 'true' : undefined}
                    className={`${buttonWidth} relative flex-shrink-0 whitespace-nowrap rounded-ui-sm border px-2.5 py-2 text-center text-xs font-semibold transition-all duration-200
                          ${isActive ? stateActiveClass : stateIdleClass}
                        `.trim()}
                    title={`第 ${idx * episodesPerPage + 1}-${Math.min(
                      (idx + 1) * episodesPerPage,
                      totalEpisodes
                    )} 集`}
                  >
                    <span className='relative z-10 flex items-center justify-center gap-1.5 truncate'>
                      {isActive && (
                        <span className={`flex-shrink-0 ${currentChipClass}`}>
                          当前
                        </span>
                      )}
                      <span className='truncate'>{label}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <button
          className='flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-ui-md border border-[rgb(var(--ui-border))] bg-[rgb(var(--ui-surface))] text-[rgb(var(--ui-text-muted))] transition-all duration-200 hover:border-[rgba(var(--ui-accent),0.45)] hover:bg-[rgba(var(--ui-surface-strong),0.82)] hover:text-[rgb(var(--ui-text))]'
          aria-label='切换集数排序'
          title={descending ? '切换为正序' : '切换为倒序'}
          onClick={onToggleDescending}
          type='button'
        >
          <svg
            className='w-4 h-4'
            fill='none'
            stroke='currentColor'
            viewBox='0 0 24 24'
          >
            <path
              strokeLinecap='round'
              strokeLinejoin='round'
              strokeWidth='2'
              d='M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4'
            />
          </svg>
        </button>
      </div>

      <div className='grid flex-1 grid-cols-[repeat(auto-fill,minmax(44px,1fr))] justify-center gap-2 overflow-y-auto pb-1 pr-0.5 sm:grid-cols-[repeat(auto-fill,minmax(48px,1fr))]'>
        {episodes.map((episodeNumber) => {
          const isActive = episodeNumber === value;
          return (
            <button
              key={episodeNumber}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onEpisodeClick(episodeNumber);
              }}
              className={`flex h-10 w-full cursor-pointer items-center justify-center rounded-ui-sm border text-sm font-medium transition-all duration-200
                    ${
                      isActive
                        ? 'border border-[rgb(var(--ui-accent))] bg-[rgb(var(--ui-accent))] text-[rgb(var(--ui-on-accent))] shadow-ui-soft'
                        : stateIdleClass
                    }`.trim()}
              type='button'
              aria-label={`第${episodeNumber}集`}
            >
              {episodeNumber}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default EpisodeSelectorEpisodes;
