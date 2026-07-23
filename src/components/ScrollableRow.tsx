import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface ScrollableRowProps {
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
  scrollDistance?: number;
}

export default function ScrollableRow({
  children,
  className,
  contentClassName,
  scrollDistance = 1000,
}: ScrollableRowProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [showLeftScroll, setShowLeftScroll] = useState(false);
  const [showRightScroll, setShowRightScroll] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const checkScroll = () => {
    if (containerRef.current) {
      const { scrollWidth, clientWidth, scrollLeft } = containerRef.current;

      // 计算是否需要左右滚动按钮
      const threshold = 1; // 容差值，避免浮点误差
      const canScrollRight =
        scrollWidth - (scrollLeft + clientWidth) > threshold;
      const canScrollLeft = scrollLeft > threshold;

      setShowRightScroll(canScrollRight);
      setShowLeftScroll(canScrollLeft);
    }
  };

  useEffect(() => {
    // 多次延迟检查，确保内容已完全渲染
    checkScroll();

    // 监听窗口大小变化
    window.addEventListener('resize', checkScroll);

    // 创建一个 ResizeObserver 来监听容器大小变化
    const resizeObserver = new ResizeObserver(() => {
      // 延迟执行检查
      checkScroll();
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      window.removeEventListener('resize', checkScroll);
      resizeObserver.disconnect();
    };
  }, [children]); // 依赖 children，当子组件变化时重新检查

  // 添加一个额外的效果来监听子组件的变化
  useEffect(() => {
    if (containerRef.current) {
      // 监听 DOM 变化
      const observer = new MutationObserver(() => {
        setTimeout(checkScroll, 100);
      });

      observer.observe(containerRef.current, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class'],
      });

      return () => observer.disconnect();
    }
  }, []);

  const handleScrollRightClick = () => {
    if (containerRef.current) {
      containerRef.current.scrollBy({
        left: scrollDistance,
        behavior: 'smooth',
      });
    }
  };

  const handleScrollLeftClick = () => {
    if (containerRef.current) {
      containerRef.current.scrollBy({
        left: -scrollDistance,
        behavior: 'smooth',
      });
    }
  };

  return (
    <div
      className={`relative ${className || ''}`}
      onMouseEnter={() => {
        setIsHovered(true);
        // 当鼠标进入时重新检查一次
        checkScroll();
      }}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        ref={containerRef}
        className={`flex gap-4 overflow-x-auto scrollbar-hide px-1 py-1 pb-6 sm:gap-5 ${contentClassName || ''}`}
        onScroll={checkScroll}
      >
        {children}
      </div>
      {showLeftScroll && (
        <div
          className={`absolute inset-y-0 left-0 z-[600] hidden w-20 items-center justify-start bg-gradient-to-r from-[rgb(var(--ui-bg-elevated)/0.92)] via-[rgb(var(--ui-bg-elevated)/0.42)] to-transparent pl-2 transition-opacity duration-200 sm:flex ${
            isHovered ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <button
            aria-label='向左滚动'
            className='pointer-events-auto inline-flex h-10 w-10 items-center justify-center rounded-full border border-[rgb(var(--ui-border)/0.52)] bg-[rgb(var(--ui-surface-strong)/0.78)] text-[rgb(var(--ui-text))] shadow-ui-soft backdrop-blur-md transition-[border-color,background-color,transform] duration-150 ease ui-hover-scale-sm hover:border-[rgb(var(--ui-accent)/0.36)] hover:bg-[rgb(var(--ui-surface-strong)/0.94)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40'
            onClick={handleScrollLeftClick}
            type='button'
          >
            <ChevronLeft className='h-5 w-5' />
          </button>
        </div>
      )}

      {showRightScroll && (
        <div
          className={`absolute inset-y-0 right-0 z-[600] hidden w-20 items-center justify-end bg-gradient-to-l from-[rgb(var(--ui-bg-elevated)/0.92)] via-[rgb(var(--ui-bg-elevated)/0.42)] to-transparent pr-2 transition-opacity duration-200 sm:flex ${
            isHovered ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <button
            aria-label='向右滚动'
            className='pointer-events-auto inline-flex h-10 w-10 items-center justify-center rounded-full border border-[rgb(var(--ui-border)/0.52)] bg-[rgb(var(--ui-surface-strong)/0.78)] text-[rgb(var(--ui-text))] shadow-ui-soft backdrop-blur-md transition-[border-color,background-color,transform] duration-150 ease ui-hover-scale-sm hover:border-[rgb(var(--ui-accent)/0.36)] hover:bg-[rgb(var(--ui-surface-strong)/0.94)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40'
            onClick={handleScrollRightClick}
            type='button'
          >
            <ChevronRight className='h-5 w-5' />
          </button>
        </div>
      )}
    </div>
  );
}
