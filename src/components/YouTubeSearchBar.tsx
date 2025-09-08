'use client';

import { Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

const YouTubeSearchBar = () => {
  const router = useRouter();
  const [query, setQuery] = useState('');

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      router.push(`/search?q=${encodeURIComponent(query.trim())}`);
    }
  };

  return (
    <form onSubmit={handleSearch} className='w-full'>
      <div className='flex'>
        <div className='flex-1 relative'>
          <input
            type='text'
            placeholder='搜索影片...'
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className='w-full h-8 px-4 bg-[#121212] border border-[#333333] rounded-l-full text-white placeholder-[#717171] text-sm focus:border-[#3ea6ff] focus:outline-none'
          />
        </div>
        <button
          type='submit'
          className='px-3 bg-[#222222] border border-l-0 border-[#333333] rounded-r-full hover:bg-[#3a3a3a] transition-colors flex items-center justify-center'
        >
          <Search size={16} className='text-[#aaaaaa]' />
        </button>
      </div>
    </form>
  );
};

export default YouTubeSearchBar;