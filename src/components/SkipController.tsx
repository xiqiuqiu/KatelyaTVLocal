/* eslint-disable @typescript-eslint/no-explicit-any, no-console */
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  deleteSkipConfig,
  EpisodeSkipConfig,
  getSkipConfig,
  saveSkipConfig,
  SkipSegment,
} from '@/lib/db.client';

interface SkipControllerProps {
  source: string;
  id: string;
  title: string;
  artPlayerRef: React.MutableRefObject<any>;
  currentTime?: number;
  duration?: number;
  isSettingMode?: boolean;
  onSettingModeChange?: (isOpen: boolean) => void;
  onNextEpisode?: () => void; // 新增：跳转下一集的回调
}

export default function SkipController({
  source,
  id,
  title,
  artPlayerRef,
  currentTime = 0,
  duration = 0,
  isSettingMode = false,
  onSettingModeChange,
  onNextEpisode,
}: SkipControllerProps) {
  const [skipConfig, setSkipConfig] = useState<EpisodeSkipConfig | null>(null);
  const [showSkipButton, setShowSkipButton] = useState(false);
  const [currentSkipSegment, setCurrentSkipSegment] =
    useState<SkipSegment | null>(null);
  const [newSegment, setNewSegment] = useState<Partial<SkipSegment>>({});

  // 新增状态：批量设置模式 - 支持分:秒格式
  const [batchSettings, setBatchSettings] = useState({
    openingStart: '0:00', // 片头开始时间（分:秒格式）
    openingEnd: '1:30', // 片头结束时间（分:秒格式，90秒=1分30秒）
    endingStart: '2:00', // 片尾开始时间（剩余时间：还剩多少时间开始倒计时）
    endingEnd: '', // 片尾结束时间（可选，空表示直接跳转下一集）
    autoSkip: true, // 自动跳过开关
    autoNextEpisode: true, // 自动下一集开关
  });
  const [showCountdown, setShowCountdown] = useState(false);
  const [countdownSeconds, setCountdownSeconds] = useState(0);
  const [isCountdownPaused, setIsCountdownPaused] = useState(false);
  const [isWarningMode, setIsWarningMode] = useState(false); // 新增：预告模式状态
  const [isDesktopPanelOpen, setIsDesktopPanelOpen] = useState(true); // 新增：桌面端面板展开状态
  const isCountdownPausedRef = useRef(isCountdownPaused); // 用于同步暂停状态

  const lastSkipTimeRef = useRef<number>(0);
  const skipTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const autoSkipTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // 时间格式转换函数
  const timeToSeconds = useCallback((timeStr: string): number => {
    if (!timeStr || timeStr.trim() === '') return 0;

    // 支持多种格式: "2:10", "2:10.5", "130", "130.5"
    if (timeStr.includes(':')) {
      const parts = timeStr.split(':');
      const minutes = parseInt(parts[0]) || 0;
      const seconds = parseFloat(parts[1]) || 0;
      return minutes * 60 + seconds;
    } else {
      return parseFloat(timeStr) || 0;
    }
  }, []);

  const secondsToTime = useCallback((seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const decimal = seconds % 1;
    if (decimal > 0) {
      return `${mins}:${secs.toString().padStart(2, '0')}.${Math.floor(
        decimal * 10
      )}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }, []);

  // 新增：时间计算辅助函数
  const calculateActualStartTime = useCallback(
    (segment: SkipSegment): number => {
      if (!duration) return 0;

      // 存储的片段 start 已经是绝对秒数，直接使用并确保在 [0, duration] 范围内
      const start = typeof segment.start === 'number' ? segment.start : 0;
      return Math.max(0, Math.min(start, duration));
    },
    [duration]
  );

  const validateTimeRange = useCallback(
    (start: number, end: number): boolean => {
      if (!duration) return false;
      return start >= 0 && end > start && end <= duration;
    },
    [duration]
  );

  
  // 使用useMemo缓存计算结果，提升性能
  const activeEndingSegments = useMemo(() => {
    if (!skipConfig?.segments?.length) {
      console.log('SkipController: 没有找到跳过片段配置');
      return [];
    }

    const endingSegments = skipConfig.segments
      .filter((s) => s.type === 'ending' && s.autoNextEpisode !== false)
      .sort((a, b) => a.start - b.start); // 按开始时间排序

    console.log('SkipController: 计算片尾片段', {
      totalSegments: skipConfig.segments.length,
      endingSegments: endingSegments.length,
      segments: endingSegments
    });

    return endingSegments;
  }, [skipConfig]);

  const hasAutoSkipSegments = useMemo(() => {
    return skipConfig?.segments?.some((s) => s.autoSkip !== false) || false;
  }, [skipConfig]);

  // 新增：倒计时消息格式化函数 - 支持预告和跳转两种模式
  const getCountdownMessage = useCallback((seconds: number, isWarning = false): string => {
    if (isWarning) {
      return `${seconds}秒后将跳过片尾`;
    }
    
    if (seconds > 60) {
      const minutes = Math.floor(seconds / 60);
      const remainingSeconds = seconds % 60;
      return `${minutes}分${remainingSeconds}秒后自动播放下一集`;
    }
    return `${seconds}秒后自动播放下一集`;
  }, []);

  // 加载跳过配置
  const loadSkipConfig = useCallback(async () => {
    try {
      const config = await getSkipConfig(source, id);
      setSkipConfig(config);
    } catch (err) {
      console.error('加载跳过配置失败:', err);
    }
  }, [source, id]);

  // 自动跳过逻辑
  const handleAutoSkip = useCallback(
    (segment: SkipSegment) => {
      if (!artPlayerRef.current) return;

      const targetTime = segment.end + 1;
      artPlayerRef.current.currentTime = targetTime;
      lastSkipTimeRef.current = Date.now();

      // 显示跳过提示
      if (artPlayerRef.current.notice) {
        const segmentName = segment.type === 'opening' ? '片头' : '片尾';
        artPlayerRef.current.notice.show = `自动跳过${segmentName}`;
      }

      setCurrentSkipSegment(null);
    },
    [artPlayerRef]
  );

  // 开始片尾倒计时 - 支持预告计时和目标时间跳转
  const startEndingCountdown = useCallback(
    (seconds: number, targetTime?: number, isWarning = false) => {
      console.log('SkipController: startEndingCountdown 被调用', {
        seconds,
        targetTime,
        isWarning,
        hasNextEpisode: !!onNextEpisode
      });

      // 清理所有相关状态
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }

      // 重置状态
      setShowCountdown(true);
      setCountdownSeconds(seconds);
      setIsCountdownPaused(false); // 重置暂停状态
      setIsWarningMode(isWarning); // 设置预告模式

      // 如果时间已到，立即执行
      if (seconds <= 0) {
        if (targetTime && artPlayerRef.current) {
          // 如果有目标时间，跳转到指定时间
          artPlayerRef.current.currentTime = targetTime;
        } else if (onNextEpisode) {
          // 否则跳转下一集
          onNextEpisode();
        }
        setShowCountdown(false);
        return;
      }

      // 使用ref来获取最新的暂停状态，避免闭包问题
      countdownIntervalRef.current = setInterval(() => {
        setCountdownSeconds((prev) => {
          // 通过ref获取最新的暂停状态
          if (isCountdownPausedRef.current) return prev;

          if (prev <= 1) {
            // 倒计时结束
            countdownIntervalRef.current && clearInterval(countdownIntervalRef.current);
            countdownIntervalRef.current = null;
            setShowCountdown(false);

            if (targetTime && artPlayerRef.current) {
              // 如果有目标时间，跳转到指定时间
              artPlayerRef.current.currentTime = targetTime;
            } else if (onNextEpisode) {
              // 否则跳转下一集
              console.log('SkipController: 准备调用 onNextEpisode 跳转到下一集');
              try {
                onNextEpisode();
                console.log('SkipController: onNextEpisode 调用成功');
              } catch (error) {
                console.error('跳转下一集失败:', error);
                setShowCountdown(false);
              }
            } else {
              console.log('SkipController: onNextEpisode 回调函数不存在');
            }
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    },
    [onNextEpisode, artPlayerRef]
  );

  // 检查片尾倒计时 - 重新设计：提前5秒倒计时提醒
  const checkEndingCountdown = useCallback(
    (time: number) => {
      if (!skipConfig?.segments?.length || !duration || !onNextEpisode) {
        console.log('SkipController: checkEndingCountdown 条件不满足', {
          hasSegments: !!skipConfig?.segments?.length,
          duration,
          hasNextEpisode: !!onNextEpisode
        });
        return;
      }

      // 使用缓存的片尾片段
      const endingSegments = activeEndingSegments;
      if (!endingSegments.length) {
        console.log('SkipController: 没有找到片尾片段');
        return;
      }

      for (const segment of endingSegments) {
        // 使用辅助函数计算实际开始时间
        const actualStartTime = calculateActualStartTime(segment);

        // 验证时间范围有效性
        if (!validateTimeRange(actualStartTime, segment.end)) {
          continue;
        }

        // 新逻辑：在片尾开始时间前5秒开始倒计时提醒
        const warningTime = Math.max(0, actualStartTime - 5); // 提前5秒

        // 当到达警告时间且还未开始倒计时时，启动5秒倒计时
        if (time >= warningTime && time < actualStartTime && !showCountdown) {
          console.log('SkipController: 启动片尾预告倒计时', {
            currentTime: time,
            warningTime,
            actualStartTime,
            showCountdown
          });
          startEndingCountdown(5, undefined, true); // 5秒倒计时，直接跳转下一集，预告模式
          break;
        }
      }
    },
    [
      skipConfig,
      duration,
      onNextEpisode,
      showCountdown,
      startEndingCountdown,
      activeEndingSegments,
      calculateActualStartTime,
      validateTimeRange,
    ]
  );

  // 检查当前播放时间是否在跳过区间内 - 优化性能
  const checkSkipSegment = useCallback(
    (time: number) => {
      if (!skipConfig?.segments?.length) return;

      const currentSegment = skipConfig.segments.find(
        (segment) => time >= segment.start && time <= segment.end
      );

      if (currentSegment && currentSegment !== currentSkipSegment) {
        setCurrentSkipSegment(currentSegment);

        // 使用缓存的计算结果
        if (hasAutoSkipSegments) {
          // 自动跳过：延迟1秒执行跳过
          if (autoSkipTimeoutRef.current) {
            clearTimeout(autoSkipTimeoutRef.current);
          }
          autoSkipTimeoutRef.current = setTimeout(() => {
            handleAutoSkip(currentSegment);
          }, 1000);

          setShowSkipButton(false); // 自动跳过时不显示按钮
        } else {
          // 手动模式：显示跳过按钮
          setShowSkipButton(true);

          // 自动隐藏跳过按钮
          if (skipTimeoutRef.current) {
            clearTimeout(skipTimeoutRef.current);
          }
          skipTimeoutRef.current = setTimeout(() => {
            setShowSkipButton(false);
            setCurrentSkipSegment(null);
          }, 8000);
        }
      } else if (!currentSegment && currentSkipSegment) {
        setCurrentSkipSegment(null);
        setShowSkipButton(false);
        if (skipTimeoutRef.current) {
          clearTimeout(skipTimeoutRef.current);
        }
        if (autoSkipTimeoutRef.current) {
          clearTimeout(autoSkipTimeoutRef.current);
        }
      }

      // 检查片尾倒计时
      checkEndingCountdown(time);
    },
    [
      skipConfig,
      currentSkipSegment,
      handleAutoSkip,
      checkEndingCountdown,
      hasAutoSkipSegments,
    ]
  );

  // 执行跳过
  const handleSkip = useCallback(() => {
    if (!currentSkipSegment || !artPlayerRef.current) return;

    const targetTime = currentSkipSegment.end + 1; // 跳到片段结束后1秒
    artPlayerRef.current.currentTime = targetTime;
    lastSkipTimeRef.current = Date.now();

    setShowSkipButton(false);
    setCurrentSkipSegment(null);

    if (skipTimeoutRef.current) {
      clearTimeout(skipTimeoutRef.current);
    }

    // 显示跳过提示
    if (artPlayerRef.current.notice) {
      const segmentName =
        currentSkipSegment.type === 'opening' ? '片头' : '片尾';
      artPlayerRef.current.notice.show = `已跳过${segmentName}`;
    }
  }, [currentSkipSegment, artPlayerRef]);

  // 保存新的跳过片段（单个片段模式）
  const handleSaveSegment = useCallback(async () => {
    if (!newSegment.start || !newSegment.end || !newSegment.type) {
      alert('请填写完整的跳过片段信息');
      return;
    }

    if (newSegment.start >= newSegment.end) {
      alert('开始时间必须小于结束时间');
      return;
    }

    try {
      const segment: SkipSegment = {
        start: newSegment.start,
        end: newSegment.end,
        type: newSegment.type as 'opening' | 'ending',
        title:
          newSegment.title || (newSegment.type === 'opening' ? '片头' : '片尾'),
        autoSkip: true, // 默认开启自动跳过
        autoNextEpisode: newSegment.type === 'ending', // 片尾默认开启自动下一集
      };

      const updatedConfig: EpisodeSkipConfig = {
        source,
        id,
        title,
        segments: skipConfig?.segments
          ? [...skipConfig.segments, segment]
          : [segment],
        updated_time: Date.now(),
      };

      await saveSkipConfig(source, id, updatedConfig);
      setSkipConfig(updatedConfig);
      onSettingModeChange?.(false);
      setNewSegment({});

      alert('跳过片段已保存');
    } catch (err) {
      console.error('保存跳过片段失败:', err);
      alert('保存失败，请重试');
    }
  }, [newSegment, skipConfig, source, id, title, onSettingModeChange]);

  // 保存批量设置的跳过配置
  const handleSaveBatchSettings = useCallback(async () => {
    const segments: SkipSegment[] = [];

    // 添加片头设置
    if (batchSettings.openingStart && batchSettings.openingEnd) {
      const start = timeToSeconds(batchSettings.openingStart);
      const end = timeToSeconds(batchSettings.openingEnd);

      if (start >= end) {
        alert('片头开始时间必须小于结束时间');
        return;
      }

      segments.push({
        start,
        end,
        type: 'opening',
        title: '片头',
        autoSkip: batchSettings.autoSkip,
      });
    }

    // 添加片尾设置
    if (batchSettings.endingStart) {
      const endingStartSeconds = timeToSeconds(batchSettings.endingStart);

      // 剩余时间模式：从视频总长度减去剩余时间
      let actualStartSeconds = duration - endingStartSeconds;

      // 确保开始时间在有效范围内
      if (actualStartSeconds < 0) {
        actualStartSeconds = 0;
      } else if (actualStartSeconds >= duration) {
        alert(`片尾开始时间超出视频长度（总长：${secondsToTime(duration)}）`);
        return;
      }

      // 如果没有设置结束时间，则直接跳转到下一集
      if (!batchSettings.endingEnd || batchSettings.endingEnd.trim() === '') {
        // 直接从指定时间跳转下一集
        segments.push({
          start: actualStartSeconds,
          end: duration, // 设置为视频总长度
          type: 'ending',
          title: `剩余${batchSettings.endingStart}时跳转下一集`,
          autoSkip: batchSettings.autoSkip,
          autoNextEpisode: batchSettings.autoNextEpisode,
        });
      } else {
        const endingEndSeconds = timeToSeconds(batchSettings.endingEnd);
        const actualEndSeconds = duration - endingEndSeconds;

        if (actualStartSeconds >= actualEndSeconds) {
          alert('片尾开始时间必须小于结束时间');
          return;
        }

        segments.push({
          start: actualStartSeconds,
          end: actualEndSeconds,
          type: 'ending',
          title: '片尾',
          autoSkip: batchSettings.autoSkip,
          autoNextEpisode: batchSettings.autoNextEpisode,
        });
      }
    }

    if (segments.length === 0) {
      alert('请至少设置片头或片尾时间');
      return;
    }

    try {
      const updatedConfig: EpisodeSkipConfig = {
        source,
        id,
        title,
        segments,
        updated_time: Date.now(),
      };

      await saveSkipConfig(source, id, updatedConfig);
      setSkipConfig(updatedConfig);
      onSettingModeChange?.(false);

      // 重置批量设置
      setBatchSettings({
        openingStart: '0:00',
        openingEnd: '1:30',
        endingStart: '2:00',
        endingEnd: '',
        autoSkip: true,
        autoNextEpisode: true,
      });

      alert('跳过配置已保存');
    } catch (err) {
      console.error('保存跳过配置失败:', err);
      alert('保存失败，请重试');
    }
  }, [
    batchSettings,
    duration,
    source,
    id,
    title,
    onSettingModeChange,
    timeToSeconds,
    secondsToTime,
  ]);

  // 删除跳过片段
  const handleDeleteSegment = useCallback(
    async (index: number) => {
      if (!skipConfig?.segments) return;

      try {
        const updatedSegments = skipConfig.segments.filter(
          (_, i) => i !== index
        );

        if (updatedSegments.length === 0) {
          // 如果没有片段了，删除整个配置
          await deleteSkipConfig(source, id);
          setSkipConfig(null);
        } else {
          // 更新配置
          const updatedConfig: EpisodeSkipConfig = {
            ...skipConfig,
            segments: updatedSegments,
            updated_time: Date.now(),
          };
          await saveSkipConfig(source, id, updatedConfig);
          setSkipConfig(updatedConfig);
        }

        alert('跳过片段已删除');
      } catch (err) {
        console.error('删除跳过片段失败:', err);
        alert('删除失败，请重试');
      }
    },
    [skipConfig, source, id]
  );

  // 格式化时间显示
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // 初始化加载配置
  useEffect(() => {
    loadSkipConfig();
  }, [loadSkipConfig]);

  // 监听播放时间变化
  useEffect(() => {
    if (currentTime > 0) {
      checkSkipSegment(currentTime);
    }
  }, [currentTime, checkSkipSegment]);

  // 同步暂停状态到ref
  useEffect(() => {
    isCountdownPausedRef.current = isCountdownPaused;
  }, [isCountdownPaused]);

  // 添加播放时间变化监听，处理异常情况
  useEffect(() => {
    if (currentTime < 0 || currentTime > duration) {
      // 处理异常时间值
      setShowCountdown(false);
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
    }
  }, [currentTime, duration]);

  // 清理定时器 - 增强版
  useEffect(() => {
    return () => {
      if (skipTimeoutRef.current) {
        clearTimeout(skipTimeoutRef.current);
      }
      if (autoSkipTimeoutRef.current) {
        clearTimeout(autoSkipTimeoutRef.current);
      }
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
      }
    };
  }, []);

  return (
    <div className='skip-controller'>
      {/* 倒计时显示 - 简化样式 */}
      {showCountdown && (
        <div className='fixed top-20 left-1/2 transform -translate-x-1/2 z-[9999] bg-black/80 text-white px-4 py-2 rounded-lg backdrop-blur-sm border border-white/20 shadow-lg animate-fade-in'>
          <div className='flex items-center space-x-3'>
            <div className='flex flex-col'>
              <span className='text-sm font-medium'>
                {getCountdownMessage(countdownSeconds, isWarningMode)}
              </span>
              <span className='text-xs text-gray-300'>
                {isCountdownPaused ? '已暂停' : isWarningMode ? '即将跳过片尾' : '片尾跳转已启用'}
              </span>
            </div>
            <div className='flex items-center space-x-2'>
              <button
                onClick={() => setIsCountdownPaused(!isCountdownPaused)}
                className='px-2 py-1 bg-white/20 hover:bg-white/30 rounded text-xs transition-colors'
                title={isCountdownPaused ? '继续' : '暂停'}
              >
                {isCountdownPaused ? '▶' : '⏸'}
              </button>
              <button
                onClick={() => {
                  setShowCountdown(false);
                  setIsCountdownPaused(false);
                  setIsWarningMode(false);
                  if (countdownIntervalRef.current) {
                    clearInterval(countdownIntervalRef.current);
                    countdownIntervalRef.current = null;
                  }
                }}
                className='px-2 py-1 bg-white/20 hover:bg-white/30 rounded text-xs transition-colors'
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 跳过按钮 */}
      {showSkipButton && currentSkipSegment && (
        <div className='fixed top-20 right-4 z-[9999] bg-black/80 text-white px-4 py-2 rounded-lg backdrop-blur-sm border border-white/20 shadow-lg animate-fade-in'>
          <div className='flex items-center space-x-3'>
            <span className='text-sm'>
              {currentSkipSegment.type === 'opening'
                ? '检测到片头'
                : '检测到片尾'}
            </span>
            <button
              onClick={handleSkip}
              className='px-3 py-1 bg-green-600 hover:bg-green-700 rounded text-sm font-medium transition-colors'
            >
              跳过
            </button>
          </div>
        </div>
      )}

      {/* 设置模式面板 - 重新设计 */}
      {isSettingMode && (
        <div className='fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9999] p-4'>
          <div className='bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-8 w-full max-w-4xl max-h-[90vh] overflow-y-auto border border-gray-200 dark:border-gray-700'>
            {/* 头部 */}
            <div className='flex items-center justify-between mb-8'>
              <div>
                <h3 className='text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2'>
                  智能跳过设置
                </h3>
                <p className='text-sm text-gray-600 dark:text-gray-400'>
                  自动跳过片头片尾，提升观影体验
                </p>
              </div>
              <button
                onClick={() => {
                  onSettingModeChange?.(false);
                  setBatchSettings({
                    openingStart: '0:00',
                    openingEnd: '1:30',
                    endingStart: '2:00',
                    endingEnd: '',
                    autoSkip: true,
                    autoNextEpisode: true,
                  });
                }}
                className='p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors'
              >
                <svg
                  className='w-6 h-6 text-gray-500'
                  fill='none'
                  stroke='currentColor'
                  viewBox='0 0 24 24'
                >
                  <path
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    strokeWidth={2}
                    d='M6 18L18 6M6 6l12 12'
                  />
                </svg>
              </button>
            </div>

            {/* 全局开关 - 重新设计 */}
            <div className='bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 p-6 rounded-2xl mb-8 border border-blue-100 dark:border-blue-800/30'>
              <div className='flex items-center justify-between mb-4'>
                <div className='flex items-center space-x-3'>
                  <div className='w-10 h-10 bg-blue-500 rounded-xl flex items-center justify-center'>
                    <svg
                      className='w-6 h-6 text-white'
                      fill='none'
                      stroke='currentColor'
                      viewBox='0 0 24 24'
                    >
                      <path
                        strokeLinecap='round'
                        strokeLinejoin='round'
                        strokeWidth={2}
                        d='M13 10V3L4 14h7v7l9-11h-7z'
                      />
                    </svg>
                  </div>
                  <div>
                    <label className='flex items-center space-x-3 cursor-pointer'>
                      <input
                        type='checkbox'
                        checked={batchSettings.autoSkip}
                        onChange={(e) =>
                          setBatchSettings({
                            ...batchSettings,
                            autoSkip: e.target.checked,
                          })
                        }
                        className='w-5 h-5 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600'
                      />
                      <span className='text-lg font-semibold text-gray-900 dark:text-gray-100'>
                        启用自动跳过
                      </span>
                    </label>
                  </div>
                </div>
              </div>
              <div className='flex items-center justify-between'>
                <div className='flex items-center space-x-3'>
                  <div className='w-10 h-10 bg-purple-500 rounded-xl flex items-center justify-center'>
                    <svg
                      className='w-6 h-6 text-white'
                      fill='none'
                      stroke='currentColor'
                      viewBox='0 0 24 24'
                    >
                      <path
                        strokeLinecap='round'
                        strokeLinejoin='round'
                        strokeWidth={2}
                        d='M11.933 12.8a1 1 0 000-1.6L6.6 7.2A1 1 0 005 8v8a1 1 0 001.6.8l5.333-4zM19.933 12.8a1 1 0 000-1.6l-5.333-4A1 1 0 0013 8v8a1 1 0 001.6.8l5.333-4z'
                      />
                    </svg>
                  </div>
                  <div>
                    <label className='flex items-center space-x-3 cursor-pointer'>
                      <input
                        type='checkbox'
                        checked={batchSettings.autoNextEpisode}
                        onChange={(e) =>
                          setBatchSettings({
                            ...batchSettings,
                            autoNextEpisode: e.target.checked,
                          })
                        }
                        className='w-5 h-5 text-purple-600 bg-gray-100 border-gray-300 rounded focus:ring-purple-500 dark:focus:ring-purple-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600'
                      />
                      <span className='text-lg font-semibold text-gray-900 dark:text-gray-100'>
                        片尾自动播放下一集
                      </span>
                    </label>
                  </div>
                </div>
              </div>
              <div className='mt-4 p-3 bg-blue-100/50 dark:bg-blue-900/30 rounded-lg'>
                <p className='text-sm text-blue-700 dark:text-blue-300'>
                  💡
                  开启后将自动跳过设定的片头片尾，无需手动点击，享受无缝观影体验
                </p>
              </div>
            </div>

            <div className='grid grid-cols-1 lg:grid-cols-2 gap-8'>
              {/* 片头设置 - 重新设计 */}
              <div className='bg-gradient-to-br from-orange-50 to-red-50 dark:from-orange-900/20 dark:to-red-900/20 p-6 rounded-2xl border border-orange-100 dark:border-orange-800/30'>
                <div className='flex items-center space-x-3 mb-6'>
                  <div className='w-12 h-12 bg-gradient-to-br from-orange-500 to-red-500 rounded-2xl flex items-center justify-center'>
                    <span className='text-2xl'>🎬</span>
                  </div>
                  <div>
                    <h4 className='text-xl font-bold text-gray-900 dark:text-gray-100'>
                      片头设置
                    </h4>
                    <p className='text-sm text-gray-600 dark:text-gray-400'>
                      自动跳过片头，直接进入正片
                    </p>
                  </div>
                </div>

                <div className='space-y-4'>
                  <div>
                    <label className='block text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300'>
                      开始时间
                    </label>
                    <div className='relative'>
                      <input
                        type='text'
                        value={batchSettings.openingStart}
                        onChange={(e) =>
                          setBatchSettings({
                            ...batchSettings,
                            openingStart: e.target.value,
                          })
                        }
                        className='w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all duration-200'
                        placeholder='0:00'
                      />
                      <div className='absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400'>
                        <svg
                          className='w-5 h-5'
                          fill='none'
                          stroke='currentColor'
                          viewBox='0 0 24 24'
                        >
                          <path
                            strokeLinecap='round'
                            strokeLinejoin='round'
                            strokeWidth={2}
                            d='M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z'
                          />
                        </svg>
                      </div>
                    </div>
                    <p className='text-xs text-gray-500 mt-1'>
                      格式: 分:秒 (如 0:00)
                    </p>
                  </div>

                  <div>
                    <label className='block text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300'>
                      结束时间
                    </label>
                    <div className='relative'>
                      <input
                        type='text'
                        value={batchSettings.openingEnd}
                        onChange={(e) =>
                          setBatchSettings({
                            ...batchSettings,
                            openingEnd: e.target.value,
                          })
                        }
                        className='w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all duration-200'
                        placeholder='1:30'
                      />
                      <div className='absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400'>
                        <svg
                          className='w-5 h-5'
                          fill='none'
                          stroke='currentColor'
                          viewBox='0 0 24 24'
                        >
                          <path
                            strokeLinecap='round'
                            strokeLinejoin='round'
                            strokeWidth={2}
                            d='M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z'
                          />
                        </svg>
                      </div>
                    </div>
                    <p className='text-xs text-gray-500 mt-1'>
                      格式: 分:秒 (如 1:30)
                    </p>
                  </div>
                </div>
              </div>

              {/* 片尾设置 - 重新设计 */}
              <div className='bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 p-6 rounded-2xl border border-purple-100 dark:border-purple-800/30'>
                <div className='flex items-center space-x-3 mb-6'>
                  <div className='w-12 h-12 bg-gradient-to-br from-purple-500 to-pink-500 rounded-2xl flex items-center justify-center'>
                    <span className='text-2xl'>🎭</span>
                  </div>
                  <div>
                    <h4 className='text-xl font-bold text-gray-900 dark:text-gray-100'>
                      片尾设置
                    </h4>
                    <p className='text-sm text-gray-600 dark:text-gray-400'>
                      基于剩余时间智能识别片尾，自动播放下一集
                    </p>
                  </div>
                </div>

                <div className='space-y-4'>
                  <div>
                    <label className='block text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300'>
                      剩余时间
                    </label>
                    <div className='relative'>
                      <input
                        type='text'
                        value={batchSettings.endingStart}
                        onChange={(e) =>
                          setBatchSettings({
                            ...batchSettings,
                            endingStart: e.target.value,
                          })
                        }
                        className='w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all duration-200'
                        placeholder='2:00'
                      />
                      <div className='absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400'>
                        <svg
                          className='w-5 h-5'
                          fill='none'
                          stroke='currentColor'
                          viewBox='0 0 24 24'
                        >
                          <path
                            strokeLinecap='round'
                            strokeLinejoin='round'
                            strokeWidth={2}
                            d='M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z'
                          />
                        </svg>
                      </div>
                    </div>
                    <p className='text-xs text-gray-500 mt-1'>
                      当剩余时间达到此值时开始倒计时
                    </p>
                  </div>

                  <div>
                    <label className='block text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300'>
                      结束时间 - 可选（剩余时间）
                    </label>
                    <div className='relative'>
                      <input
                        type='text'
                        value={batchSettings.endingEnd}
                        onChange={(e) =>
                          setBatchSettings({
                            ...batchSettings,
                            endingEnd: e.target.value,
                          })
                        }
                        className='w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all duration-200'
                        placeholder='留空直接跳下一集'
                      />
                      <div className='absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400'>
                        <svg
                          className='w-5 h-5'
                          fill='none'
                          stroke='currentColor'
                          viewBox='0 0 24 24'
                        >
                          <path
                            strokeLinecap='round'
                            strokeLinejoin='round'
                            strokeWidth={2}
                            d='M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z'
                          />
                        </svg>
                      </div>
                    </div>
                    <p className='text-xs text-gray-500 mt-1'>
                      空白=直接跳下一集，否则跳到片尾结束时间
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* 视频信息面板 */}
            <div className='mt-8 bg-gradient-to-r from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-700 p-6 rounded-2xl border border-gray-200 dark:border-gray-600'>
              <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
                <div className='flex items-center space-x-3'>
                  <div className='w-10 h-10 bg-blue-500 rounded-xl flex items-center justify-center'>
                    <svg
                      className='w-6 h-6 text-white'
                      fill='none'
                      stroke='currentColor'
                      viewBox='0 0 24 24'
                    >
                      <path
                        strokeLinecap='round'
                        strokeLinejoin='round'
                        strokeWidth={2}
                        d='M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z'
                      />
                      <path
                        strokeLinecap='round'
                        strokeLinejoin='round'
                        strokeWidth={2}
                        d='M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
                      />
                    </svg>
                  </div>
                  <div>
                    <div className='text-sm text-gray-600 dark:text-gray-400'>
                      当前播放时间
                    </div>
                    <div className='text-lg font-semibold text-gray-900 dark:text-gray-100'>
                      {secondsToTime(currentTime)}
                    </div>
                  </div>
                </div>
                {duration > 0 && (
                  <div className='flex items-center space-x-3'>
                    <div className='w-10 h-10 bg-green-500 rounded-xl flex items-center justify-center'>
                      <svg
                        className='w-6 h-6 text-white'
                        fill='none'
                        stroke='currentColor'
                        viewBox='0 0 24 24'
                      >
                        <path
                          strokeLinecap='round'
                          strokeLinejoin='round'
                          strokeWidth={2}
                          d='M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z'
                        />
                      </svg>
                    </div>
                    <div>
                      <div className='text-sm text-gray-600 dark:text-gray-400'>
                        视频总长度
                      </div>
                      <div className='text-lg font-semibold text-gray-900 dark:text-gray-100'>
                        {secondsToTime(duration)}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className='mt-4 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-xl'>
                <div className='text-sm text-blue-700 dark:text-blue-300 space-y-1'>
                  <p className='font-medium'>💡 使用提示</p>
                  <p>
                    • <strong>片头示例:</strong> 从 0:00 自动跳到 1:30
                  </p>
                  <p>
                    • <strong>片尾示例:</strong> 剩余 2:00
                    时开始倒计时，自动跳下一集
                  </p>
                  <p>
                    • <strong>支持格式:</strong> 1:30 (1分30秒) 或 90 (90秒)
                  </p>
                </div>
              </div>
            </div>

            {/* 操作按钮 */}
            <div className='flex space-x-4 mt-8'>
              <button
                onClick={handleSaveBatchSettings}
                className='flex-1 px-6 py-4 bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white rounded-xl font-semibold transition-all duration-200 hover:scale-105 active:scale-95 shadow-lg hover:shadow-xl'
              >
                <div className='flex items-center justify-center space-x-2'>
                  <svg
                    className='w-5 h-5'
                    fill='none'
                    stroke='currentColor'
                    viewBox='0 0 24 24'
                  >
                    <path
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      strokeWidth={2}
                      d='M5 13l4 4L19 7'
                    />
                  </svg>
                  <span>保存智能配置</span>
                </div>
              </button>
              <button
                onClick={() => {
                  onSettingModeChange?.(false);
                  setBatchSettings({
                    openingStart: '0:00',
                    openingEnd: '1:30',
                    endingStart: '2:00',
                    endingEnd: '',
                    autoSkip: true,
                    autoNextEpisode: true,
                  });
                }}
                className='flex-1 px-6 py-4 bg-gradient-to-r from-gray-500 to-gray-600 hover:from-gray-600 hover:to-gray-700 text-white rounded-xl font-semibold transition-all duration-200 hover:scale-105 active:scale-95 shadow-lg hover:shadow-xl'
              >
                <div className='flex items-center justify-center space-x-2'>
                  <svg
                    className='w-5 h-5'
                    fill='none'
                    stroke='currentColor'
                    viewBox='0 0 24 24'
                  >
                    <path
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      strokeWidth={2}
                      d='M6 18L18 6M6 6l12 12'
                    />
                  </svg>
                  <span>取消</span>
                </div>
              </button>
            </div>

            {/* 分割线 */}
            <div className='my-6 border-t border-gray-200 dark:border-gray-600'></div>

            {/* 传统单个设置模式 */}
            <details className='mb-4'>
              <summary className='cursor-pointer text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'>
                高级设置：添加单个片段
              </summary>
              <div className='mt-4 space-y-4 pl-4 border-l-2 border-gray-200 dark:border-gray-600'>
                <div>
                  <label className='block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300'>
                    类型
                  </label>
                  <select
                    value={newSegment.type || ''}
                    onChange={(e) =>
                      setNewSegment({
                        ...newSegment,
                        type: e.target.value as 'opening' | 'ending',
                      })
                    }
                    className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100'
                  >
                    <option value=''>选择类型</option>
                    <option value='opening'>片头</option>
                    <option value='ending'>片尾</option>
                  </select>
                </div>

                <div className='grid grid-cols-2 gap-4'>
                  <div>
                    <label className='block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300'>
                      开始时间 (秒)
                    </label>
                    <input
                      type='number'
                      value={newSegment.start || ''}
                      onChange={(e) =>
                        setNewSegment({
                          ...newSegment,
                          start: parseFloat(e.target.value),
                        })
                      }
                      className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100'
                    />
                  </div>

                  <div>
                    <label className='block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300'>
                      结束时间 (秒)
                    </label>
                    <input
                      type='number'
                      value={newSegment.end || ''}
                      onChange={(e) =>
                        setNewSegment({
                          ...newSegment,
                          end: parseFloat(e.target.value),
                        })
                      }
                      className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100'
                    />
                  </div>
                </div>

                <button
                  onClick={handleSaveSegment}
                  className='px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-medium transition-colors'
                >
                  添加片段
                </button>
              </div>
            </details>
          </div>
        </div>
      )}

      {/* 管理已有片段 - 移动端优化 */}
      {skipConfig &&
        skipConfig.segments &&
        skipConfig.segments.length > 0 &&
        !isSettingMode && (
          <>
            {/* 移动端：底部浮动按钮 */}
            <div className='lg:hidden fixed bottom-20 right-4 z-[9998]'>
              <button
                onClick={() => {
                  const panel = document.getElementById('skip-segments-panel');
                  panel?.classList.toggle('hidden');
                  // 添加触觉反馈（如果设备支持）
                  if ('vibrate' in navigator) {
                    navigator.vibrate(50);
                  }
                }}
                className='w-12 h-12 bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white rounded-full shadow-xl flex items-center justify-center transition-all duration-200 hover:scale-105 active:scale-95 animate-pulse'
              >
                <div className='relative'>
                  <svg
                    className='w-6 h-6'
                    fill='none'
                    stroke='currentColor'
                    viewBox='0 0 24 24'
                  >
                    <path
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      strokeWidth={2}
                      d='M13 5l7 7-7 7M5 5l7 7-7 7'
                    />
                  </svg>
                  <div className='absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center text-xs font-bold animate-bounce-in'>
                    {skipConfig.segments.length}
                  </div>
                </div>
              </button>
            </div>

            {/* 移动端：全屏面板 */}
            <div
              id='skip-segments-panel'
              className='lg:hidden fixed inset-0 z-[9999] bg-black/50 backdrop-blur-sm hidden'
              onClick={(e) => {
                // 点击背景关闭面板
                if (e.target === e.currentTarget) {
                  e.currentTarget.classList.add('hidden');
                }
              }}
            >
              <div className='absolute inset-x-0 bottom-0 bg-white dark:bg-gray-800 rounded-t-3xl shadow-2xl max-h-[80vh] overflow-hidden flex flex-col animate-slide-up'>
                {/* 拖拽指示器 */}
                <div className='flex justify-center pt-3 pb-2'>
                  <div className='w-12 h-1 bg-gray-300 dark:bg-gray-600 rounded-full'></div>
                </div>

                {/* 头部 */}
                <div className='flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700'>
                  <div className='flex items-center space-x-3'>
                    <div className='w-10 h-10 bg-gradient-to-r from-blue-500 to-purple-500 rounded-xl flex items-center justify-center'>
                      <svg
                        className='w-6 h-6 text-white'
                        fill='none'
                        stroke='currentColor'
                        viewBox='0 0 24 24'
                      >
                        <path
                          strokeLinecap='round'
                          strokeLinejoin='round'
                          strokeWidth={2}
                          d='M13 5l7 7-7 7M5 5l7 7-7 7'
                        />
                      </svg>
                    </div>
                    <div>
                      <h3 className='text-lg font-bold text-gray-900 dark:text-gray-100'>
                        跳过配置
                      </h3>
                      <p className='text-sm text-gray-500 dark:text-gray-400'>
                        {skipConfig.segments.length} 个片段
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      const panel = document.getElementById('skip-segments-panel');
                      panel?.classList.add('hidden');
                    }}
                    className='p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors'
                  >
                    <svg
                      className='w-6 h-6 text-gray-500'
                      fill='none'
                      stroke='currentColor'
                      viewBox='0 0 24 24'
                    >
                      <path
                        strokeLinecap='round'
                        strokeLinejoin='round'
                        strokeWidth={2}
                        d='M6 18L18 6M6 6l12 12'
                      />
                    </svg>
                  </button>
                </div>

                {/* 片段列表 */}
                <div className='flex-1 overflow-y-auto px-6 py-4 space-y-3'>
                  {skipConfig.segments.map((segment, index) => (
                    <div
                      key={index}
                      className='flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-600 transition-all duration-200'
                    >
                      <div className='flex items-center space-x-3 flex-1 min-w-0'>
                        <div
                          className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${
                            segment.type === 'opening'
                              ? 'bg-gradient-to-br from-orange-400 to-red-400'
                              : 'bg-gradient-to-br from-purple-400 to-pink-400'
                          }`}
                        >
                          <span className='text-xl'>
                            {segment.type === 'opening' ? '🎬' : '🎭'}
                          </span>
                        </div>
                        <div className='flex-1 min-w-0'>
                          <div className='font-semibold text-gray-900 dark:text-gray-100'>
                            {segment.type === 'opening' ? '片头' : '片尾'}
                          </div>
                          <div className='text-sm text-gray-600 dark:text-gray-400 truncate'>
                            {formatTime(segment.start)} - {formatTime(segment.end)}
                          </div>
                          {segment.autoSkip && (
                            <div className='inline-flex items-center mt-1 px-2 py-1 bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 rounded-lg text-xs font-medium'>
                              <svg
                                className='w-3 h-3 mr-1'
                                fill='none'
                                stroke='currentColor'
                                viewBox='0 0 24 24'
                              >
                                <path
                                  strokeLinecap='round'
                                  strokeLinejoin='round'
                                  strokeWidth={2}
                                  d='M5 13l4 4L19 7'
                                />
                              </svg>
                              自动跳过
                            </div>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          // 添加触觉反馈
                          if ('vibrate' in navigator) {
                            navigator.vibrate(100);
                          }
                          // 添加确认对话框
                          if (confirm('确定要删除这个跳过片段吗？')) {
                            handleDeleteSegment(index);
                          }
                        }}
                        className='ml-3 p-3 bg-red-500 hover:bg-red-600 text-white rounded-xl transition-all duration-200 hover:scale-105 active:scale-95 flex-shrink-0'
                        title='删除'
                      >
                        <svg
                          className='w-5 h-5'
                          fill='none'
                          stroke='currentColor'
                          viewBox='0 0 24 24'
                        >
                          <path
                            strokeLinecap='round'
                            strokeLinejoin='round'
                            strokeWidth={2}
                            d='M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16'
                          />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>

                {/* 底部操作按钮 */}
                <div className='p-6 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800'>
                  <button
                    onClick={() => {
                      onSettingModeChange?.(true);
                      const panel = document.getElementById('skip-segments-panel');
                      panel?.classList.add('hidden');
                    }}
                    className='w-full px-6 py-4 bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white rounded-xl font-semibold transition-all duration-200 hover:scale-105 active:scale-95 shadow-lg'
                  >
                    <div className='flex items-center justify-center space-x-3'>
                      <svg
                        className='w-6 h-6'
                        fill='none'
                        stroke='currentColor'
                        viewBox='0 0 24 24'
                      >
                        <path
                          strokeLinecap='round'
                          strokeLinejoin='round'
                          strokeWidth={2}
                          d='M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z'
                        />
                      </svg>
                      <span className='text-lg'>修改配置</span>
                    </div>
                  </button>
                </div>
              </div>
            </div>

            {/* 桌面端：可收起设计 */}
            <div className='hidden lg:block fixed bottom-6 left-6 z-[9998] transition-all duration-300 ease-out'>
              {/* 收起状态：只显示一个圆形按钮 */}
              {!isDesktopPanelOpen && (
                <button
                  onClick={() => setIsDesktopPanelOpen(true)}
                  className='w-14 h-14 bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white rounded-full shadow-xl flex items-center justify-center transition-all duration-200 hover:scale-105 active:scale-95 animate-pulse'
                >
                  <div className='relative'>
                    <svg
                      className='w-7 h-7'
                      fill='none'
                      stroke='currentColor'
                      viewBox='0 0 24 24'
                    >
                      <path
                        strokeLinecap='round'
                        strokeLinejoin='round'
                        strokeWidth={2}
                        d='M13 5l7 7-7 7M5 5l7 7-7 7'
                      />
                    </svg>
                    <div className='absolute -top-1 -right-1 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center text-xs font-bold animate-bounce-in'>
                      {skipConfig.segments.length}
                    </div>
                  </div>
                </button>
              )}

              {/* 展开状态：显示完整面板 */}
              {isDesktopPanelOpen && (
                <div className='max-w-md bg-white/95 dark:bg-gray-800/95 backdrop-blur-sm rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-600 animate-fade-in'>
                  <div className='p-5'>
                    <div className='flex items-center justify-between mb-4'>
                      <h4 className='text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center'>
                        <div className='w-8 h-8 bg-gradient-to-r from-blue-500 to-purple-500 rounded-xl flex items-center justify-center mr-3'>
                          <svg
                            className='w-5 h-5 text-white'
                            fill='none'
                            stroke='currentColor'
                            viewBox='0 0 24 24'
                          >
                            <path
                              strokeLinecap='round'
                              strokeLinejoin='round'
                              strokeWidth={2}
                              d='M13 5l7 7-7 7M5 5l7 7-7 7'
                            />
                          </svg>
                        </div>
                        跳过配置
                      </h4>
                      <div className='flex items-center space-x-2'>
                        <div className='text-xs text-gray-500 dark:text-gray-400'>
                          {skipConfig.segments.length} 个片段
                        </div>
                        <button
                          onClick={() => setIsDesktopPanelOpen(false)}
                          className='p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors'
                          title='收起面板'
                        >
                          <svg
                            className='w-4 h-4 text-gray-500'
                            fill='none'
                            stroke='currentColor'
                            viewBox='0 0 24 24'
                          >
                            <path
                              strokeLinecap='round'
                              strokeLinejoin='round'
                              strokeWidth={2}
                              d='M19 9l-7 7-7-7'
                            />
                          </svg>
                        </button>
                      </div>
                    </div>

                <div className='space-y-3'>
                  {skipConfig.segments.map((segment, index) => (
                    <div
                      key={index}
                      className='group flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-600 transition-all duration-200'
                    >
                      <div className='flex items-center space-x-3 flex-1'>
                        <div
                          className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                            segment.type === 'opening'
                              ? 'bg-gradient-to-br from-orange-400 to-red-400'
                              : 'bg-gradient-to-br from-purple-400 to-pink-400'
                          }`}
                        >
                          <span className='text-lg'>
                            {segment.type === 'opening' ? '🎬' : '🎭'}
                          </span>
                        </div>
                        <div className='flex-1'>
                          <div className='font-semibold text-gray-900 dark:text-gray-100'>
                            {segment.type === 'opening' ? '片头' : '片尾'}
                          </div>
                          <div className='text-sm text-gray-600 dark:text-gray-400'>
                            {formatTime(segment.start)} -{' '}
                            {formatTime(segment.end)}
                          </div>
                          {segment.autoSkip && (
                            <div className='inline-flex items-center mt-1 px-2 py-1 bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 rounded-lg text-xs font-medium'>
                              <svg
                                className='w-3 h-3 mr-1'
                                fill='none'
                                stroke='currentColor'
                                viewBox='0 0 24 24'
                              >
                                <path
                                  strokeLinecap='round'
                                  strokeLinejoin='round'
                                  strokeWidth={2}
                                  d='M5 13l4 4L19 7'
                                />
                              </svg>
                              自动跳过
                            </div>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          if (confirm('确定要删除这个跳过片段吗？')) {
                            handleDeleteSegment(index);
                          }
                        }}
                        className='opacity-0 group-hover:opacity-100 p-2 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-all duration-200 hover:scale-105 active:scale-95'
                        title='删除'
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
                            strokeWidth={2}
                            d='M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16'
                          />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>

                <div className='mt-4 pt-4 border-t border-gray-200 dark:border-gray-600'>
                  <button
                    onClick={() => onSettingModeChange?.(true)}
                    className='w-full px-4 py-3 bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white rounded-xl font-semibold transition-all duration-200 hover:scale-105 active:scale-95 shadow-lg hover:shadow-xl'
                  >
                    <div className='flex items-center justify-center space-x-2'>
                      <svg
                        className='w-5 h-5'
                        fill='none'
                        stroke='currentColor'
                        viewBox='0 0 24 24'
                      >
                        <path
                          strokeLinecap='round'
                          strokeLinejoin='round'
                          strokeWidth={2}
                          d='M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z'
                        />
                      </svg>
                      <span>修改配置</span>
                    </div>
                  </button>
                </div>
              </div>
            </div>
              )}
            </div>
          </>
        )}

      <style jsx>{`
        @keyframes fade-in {
          from {
            opacity: 0;
            transform: translateY(-10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        
        @keyframes slide-up {
          from {
            transform: translateY(100%);
          }
          to {
            transform: translateY(0);
          }
        }
        
        @keyframes bounce-in {
          0% {
            transform: scale(0.8);
            opacity: 0;
          }
          50% {
            transform: scale(1.05);
          }
          100% {
            transform: scale(1);
            opacity: 1;
          }
        }
        
        @keyframes pulse {
          0%, 100% {
            transform: scale(1);
          }
          50% {
            transform: scale(1.1);
          }
        }
        
        .animate-fade-in {
          animation: fade-in 0.3s ease-out;
        }
        
        .animate-slide-up {
          animation: slide-up 0.3s ease-out;
        }
        
        .animate-bounce-in {
          animation: bounce-in 0.4s ease-out;
        }
        
        .animate-pulse {
          animation: pulse 2s infinite;
        }
        
        @keyframes scale-in {
          from {
            transform: scale(0.8);
            opacity: 0;
          }
          to {
            transform: scale(1);
            opacity: 1;
          }
        }
        
        .animate-scale-in {
          animation: scale-in 0.2s ease-out;
        }
        
        /* 移动端特定样式 */
        @media (max-width: 1024px) {
          #skip-segments-panel {
            transition: all 0.3s ease-out;
          }
          
          #skip-segments-panel:not(.hidden) {
            animation: slide-up 0.3s ease-out;
          }
          
          /* 移动端滚动条优化 */
          #skip-segments-panel ::-webkit-scrollbar {
            width: 4px;
          }
          
          #skip-segments-panel ::-webkit-scrollbar-track {
            background: transparent;
          }
          
          #skip-segments-panel ::-webkit-scrollbar-thumb {
            background: #888;
            border-radius: 2px;
          }
          
          #skip-segments-panel ::-webkit-scrollbar-thumb:hover {
            background: #666;
          }
        }
        
        /* 触摸设备优化 */
        @media (hover: none) {
          .group:hover .opacity-0 {
            opacity: 1;
          }
          
          button:active {
            transform: scale(0.95);
          }
        }
      `}</style>
    </div>
  );
}

// 导出跳过控制器的设置按钮组件 - 重新设计
export function SkipSettingsButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className='flex items-center space-x-2 px-4 py-2.5 bg-gradient-to-r from-gray-100 to-gray-200 hover:from-gray-200 hover:to-gray-300 dark:from-gray-700 dark:to-gray-600 dark:hover:from-gray-600 dark:hover:to-gray-500 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 transition-all duration-200 hover:scale-105 active:scale-95 shadow-md hover:shadow-lg'
      title='设置跳过片头片尾'
    >
      <div className='w-5 h-5 bg-gradient-to-r from-blue-500 to-purple-500 rounded-lg flex items-center justify-center'>
        <svg
          className='w-3 h-3 text-white'
          fill='none'
          stroke='currentColor'
          viewBox='0 0 24 24'
        >
          <path
            strokeLinecap='round'
            strokeLinejoin='round'
            strokeWidth={2}
            d='M13 5l7 7-7 7M5 5l7 7-7 7'
          />
        </svg>
      </div>
      <span>智能跳过</span>
    </button>
  );
}
