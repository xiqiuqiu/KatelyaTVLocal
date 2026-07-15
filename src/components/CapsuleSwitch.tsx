/* eslint-disable react-hooks/exhaustive-deps */

import React, { useEffect, useRef, useState } from 'react';

interface CapsuleSwitchProps {
  options: { label: string; value: string }[];
  active: string;
  onChange: (value: string) => void;
  className?: string;
  'aria-label'?: string;
}

const CapsuleSwitch: React.FC<CapsuleSwitchProps> = ({
  options,
  active,
  onChange,
  className,
  'aria-label': ariaLabel,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [indicatorStyle, setIndicatorStyle] = useState<{
    left: number;
    width: number;
  }>({ left: 0, width: 0 });

  const activeIndex = options.findIndex((opt) => opt.value === active);

  // 更新指示器位置
  const updateIndicatorPosition = () => {
    if (
      activeIndex >= 0 &&
      buttonRefs.current[activeIndex] &&
      containerRef.current
    ) {
      const button = buttonRefs.current[activeIndex];
      const container = containerRef.current;
      if (button && container) {
        const buttonRect = button.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();

        if (buttonRect.width > 0) {
          setIndicatorStyle({
            left: buttonRect.left - containerRect.left,
            width: buttonRect.width,
          });
        }
      }
    }
  };

  // 组件挂载时立即计算初始位置
  useEffect(() => {
    const timeoutId = setTimeout(updateIndicatorPosition, 0);
    return () => clearTimeout(timeoutId);
  }, []);

  // 监听选中项变化
  useEffect(() => {
    const timeoutId = setTimeout(updateIndicatorPosition, 0);
    return () => clearTimeout(timeoutId);
  }, [activeIndex]);

  return (
    <div
      ref={containerRef}
      aria-label={ariaLabel}
      className={`relative inline-flex max-w-full flex-wrap rounded-full border border-[rgb(var(--ui-border))] bg-[rgba(var(--ui-surface),0.72)] p-1 ${
        className || ''
      }`}
      role='tablist'
    >
      {/* 滑动的白色背景指示器 */}
      {indicatorStyle.width > 0 && (
        <div
          className='absolute bottom-1 top-1 rounded-full bg-[rgb(var(--ui-text))] shadow-ui-soft transition-all duration-300 ease-out'
          style={{
            left: `${indicatorStyle.left}px`,
            width: `${indicatorStyle.width}px`,
          }}
        />
      )}

      {options.map((opt, index) => {
        const isActive = active === opt.value;
        return (
          <button
            key={opt.value}
            ref={(el) => {
              buttonRefs.current[index] = el;
            }}
            aria-pressed={isActive}
            onClick={() => onChange(opt.value)}
            className={`relative z-10 min-w-[3.5rem] whitespace-nowrap rounded-full px-3 py-2 text-sm font-medium transition-all duration-200 cursor-pointer sm:min-w-[4.5rem] sm:px-4 ${
              isActive
                ? 'text-[rgb(var(--ui-bg))]'
                : 'text-[rgb(var(--ui-text-muted))] hover:text-[rgb(var(--ui-text))]'
            }`}
            type='button'
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
};

export default CapsuleSwitch;
