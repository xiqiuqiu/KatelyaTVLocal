'use client';

import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';

export default function TvSearchForm({
  initialQuery,
  onSearch,
  value,
  onQueryChange,
  label = '搜索影片、电视剧、综艺',
  placeholder = '输入片名、演员或年份',
  submitLabel = '搜索',
  loading = false,
  errorId,
}: {
  initialQuery: string;
  onSearch: (query: string) => void;
  value?: string;
  onQueryChange?: (query: string) => void;
  label?: string;
  placeholder?: string;
  submitLabel?: string;
  loading?: boolean;
  errorId?: string;
}) {
  const [draft, setDraft] = useState(initialQuery);
  const query = value ?? draft;
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    setDraft(initialQuery);
    setEditing(false);
  }, [initialQuery]);

  return (
    <form
      role='search'
      aria-label='电视搜索'
      aria-busy={loading}
      className='space-y-3'
      onSubmit={(event) => {
        event.preventDefault();
        if (loading || !query.trim()) return;
        setEditing(false);
        onSearch(query.trim());
      }}
    >
      <label className='block text-lg font-semibold' htmlFor='tvSearchInput'>
        {label}
      </label>
      <div className='flex flex-wrap items-center gap-4'>
        <input
          id='tvSearchInput'
          data-tv-input
          data-tv-primary
          data-tv-focus-key='search-input'
          aria-describedby={
            errorId ? `tv-search-help ${errorId}` : 'tv-search-help'
          }
          type='search'
          enterKeyHint='search'
          readOnly={loading || !editing}
          value={query}
          onChange={(event) => {
            setDraft(event.target.value);
            onQueryChange?.(event.target.value);
          }}
          onClick={() => !loading && setEditing(true)}
          onBlur={() => setEditing(false)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) {
              if (event.key === 'Enter') event.preventDefault();
              return;
            }
            if (editing && event.key === 'ArrowDown') {
              event.preventDefault();
              setEditing(false);
              event.currentTarget.form
                ?.querySelector<HTMLButtonElement>('button[type="submit"]')
                ?.focus();
              return;
            }
            if (
              ['Escape', 'BrowserBack'].includes(event.key) ||
              event.keyCode === 4
            ) {
              event.preventDefault();
              event.stopPropagation();
              setEditing(false);
            }
          }}
          placeholder={placeholder}
          className='min-h-12 min-w-0 flex-1 rounded-ui-sm border border-[rgb(var(--ui-border))] bg-[rgb(var(--ui-surface))] px-4 py-3 !text-xl text-[rgb(var(--ui-text))] placeholder:text-[rgb(var(--ui-text-muted))]'
        />
        <button
          type='submit'
          disabled={loading}
          data-tv-focus-key='search-submit'
          className='inline-flex min-h-12 items-center justify-center gap-2 rounded-ui-sm bg-[rgb(var(--ui-accent))] px-6 py-3 text-lg font-semibold text-[rgb(var(--ui-on-accent))] disabled:opacity-60'
        >
          <Search className='h-5 w-5' />
          {loading ? '查找中' : submitLabel}
        </button>
      </div>
      <p
        id='tv-search-help'
        className='text-base text-[rgb(var(--ui-text-muted))]'
      >
        {editing
          ? `输入完成后按下键选择${submitLabel}；左右键编辑文字，返回退出输入。`
          : '方向键选择控件；在输入框按确认开始输入，也可直接选择下方的历史记录。'}
      </p>
    </form>
  );
}
