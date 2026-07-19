'use client';

import { Heart } from 'lucide-react';

type PlayFavoriteButtonProps = {
  favorited: boolean;
  onToggle: () => void;
};

function FavoriteIcon({ filled }: { filled: boolean }) {
  if (filled) {
    return (
      <svg
        className='h-7 w-7 text-[rgb(var(--ui-critical))]'
        viewBox='0 0 24 24'
        xmlns='http://www.w3.org/2000/svg'
      >
        <path
          d='M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z'
          fill='currentColor'
          stroke='currentColor'
          strokeWidth='2'
          strokeLinecap='round'
          strokeLinejoin='round'
        />
      </svg>
    );
  }

  return (
    <Heart className='h-7 w-7 stroke-[1] text-[rgb(var(--ui-text-muted))]' />
  );
}

export default function PlayFavoriteButton({
  favorited,
  onToggle,
}: PlayFavoriteButtonProps) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className='inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-[rgb(var(--ui-text))] transition hover:bg-white/10'
      aria-label={favorited ? '取消收藏' : '收藏影片'}
      type='button'
    >
      <FavoriteIcon filled={favorited} />
      <span>{favorited ? '已收藏' : '收藏'}</span>
    </button>
  );
}
