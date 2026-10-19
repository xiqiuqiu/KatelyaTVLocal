export const managementSettingsGroups = [
  {
    id: 'content',
    label: '内容与站点',
    items: [
      {
        id: 'siteConfig',
        label: '站点配置',
        description: '站点信息、搜索与图片服务',
      },
      {
        id: 'videoSource',
        label: '视频源配置',
        description: '视频源、启停与排序',
      },
    ],
  },
  {
    id: 'access',
    label: '用户与访问',
    items: [
      {
        id: 'userConfig',
        label: '用户配置',
        description: '注册开关、账号与访问权限',
      },
      {
        id: 'inviteConfig',
        label: '注册邀请码',
        description: '邀请注册与邀请码管理',
      },
    ],
  },
  {
    id: 'diagnostics',
    label: '运行与诊断',
    items: [
      {
        id: 'aiUsage',
        label: 'AI 用量监控',
        description: 'AI 请求与用量记录',
      },
      {
        id: 'playbackDebug',
        label: '播放调试日志',
        description: '播放状态与故障排查',
      },
    ],
  },
] as const;
