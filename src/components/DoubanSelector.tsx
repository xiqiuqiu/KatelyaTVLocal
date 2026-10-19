'use client';

import CapsuleSwitch from '@/components/CapsuleSwitch';

interface SelectorOption {
  label: string;
  value: string;
}
interface DoubanSelectorProps {
  type: 'movie' | 'tv' | 'show';
  primarySelection?: string;
  secondarySelection?: string;
  onPrimaryChange: (value: string) => void;
  onSecondaryChange: (value: string) => void;
}
export default function DoubanSelector({
  type,
  primarySelection,
  secondarySelection,
  onPrimaryChange,
  onSecondaryChange,
}: DoubanSelectorProps) {
  // 电影的一级选择器选项
  const moviePrimaryOptions: SelectorOption[] = [
    { label: '热门电影', value: '热门' },
    { label: '最新电影', value: '最新' },
    { label: '豆瓣高分', value: '豆瓣高分' },
    { label: '冷门佳片', value: '冷门佳片' },
  ];

  // 电影的二级选择器选项
  const movieSecondaryOptions: SelectorOption[] = [
    { label: '全部', value: '全部' },
    { label: '华语', value: '华语' },
    { label: '欧美', value: '欧美' },
    { label: '韩国', value: '韩国' },
    { label: '日本', value: '日本' },
  ];

  // 电视剧选择器选项
  const tvOptions: SelectorOption[] = [
    { label: '全部', value: 'tv' },
    { label: '国产', value: 'tv_domestic' },
    { label: '欧美', value: 'tv_american' },
    { label: '日本', value: 'tv_japanese' },
    { label: '韩国', value: 'tv_korean' },
    { label: '动漫', value: 'tv_animation' },
    { label: '纪录片', value: 'tv_documentary' },
  ];

  // 综艺选择器选项
  const showOptions: SelectorOption[] = [
    { label: '全部', value: 'show' },
    { label: '国内', value: 'show_domestic' },
    { label: '国外', value: 'show_foreign' },
  ];

  const secondaryOptions =
    type === 'movie'
      ? movieSecondaryOptions
      : type === 'tv'
      ? tvOptions
      : showOptions;
  return (
    <div className='ui-discovery-filters space-y-4'>
      {type === 'movie' && (
        <CapsuleSwitch
          aria-label='电影排序'
          options={moviePrimaryOptions}
          active={primarySelection || moviePrimaryOptions[0].value}
          onChange={onPrimaryChange}
        />
      )}
      <CapsuleSwitch
        aria-label={type === 'movie' ? '电影地区' : '节目分类'}
        options={secondaryOptions}
        active={secondarySelection || secondaryOptions[0].value}
        onChange={onSecondaryChange}
      />
    </div>
  );
}
