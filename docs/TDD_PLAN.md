# KatelyaTV YouTube 风格重构 - TDD 开发计划

## 📋 TDD 概述

本文档基于 [YouTube UI 升级方案](./YOUTUBE_UI_UPGRADE_PLAN.md) 制定详细的测试驱动开发（TDD）计划，确保重构过程的质量和可靠性。

### TDD 原则

- **Red-Green-Refactor**: 先写失败测试，然后编写最少代码使测试通过，最后重构优化
- **测试优先**: 每个功能必须先有测试，再有实现
- **持续集成**: 每次代码提交都必须通过所有测试
- **向后兼容**: 确保现有功能完全保持不变

## 🧪 测试架构设计

### 测试分层策略

```
测试金字塔
    ┌─────────────┐
    │   E2E Tests │  < 10% - 端到端测试
    │  (Cypress)  │
    ├─────────────┤
    │ Integration │  ~ 20% - 集成测试
    │    Tests    │
    ├─────────────┤
    │  Unit Tests │  ~ 70% - 单元测试
    │   (Jest)    │
    └─────────────┘
```

### 测试技术栈

- **单元测试**: Jest + React Testing Library
- **集成测试**: Jest + MSW (Mock Service Worker)
- **视觉回归测试**: Chromatic + Storybook
- **端到端测试**: Cypress
- **性能测试**: Lighthouse CI

## 📝 阶段一：核心布局重构 TDD

### 1.1 PageLayout 组件重构

#### 测试用例设计

**Test Suite: PageLayout.test.tsx**

```typescript
// 测试文件结构
describe('PageLayout Component', () => {
  describe('基础功能测试', () => {
    it('应该渲染顶部导航栏', () => {});
    it('应该渲染侧边栏', () => {});
    it('应该渲染主内容区域', () => {});
    it('应该正确处理侧边栏折叠状态', () => {});
  });

  describe('响应式布局测试', () => {
    it('在移动端应该隐藏侧边栏', () => {});
    it('在移动端应该显示底部导航', () => {});
    it('在桌面端应该显示完整布局', () => {});
  });

  describe('向后兼容性测试', () => {
    it('应该保持现有 props 接口', () => {});
    it('应该正确处理 activePath 属性', () => {});
    it('应该保持现有的路由逻辑', () => {});
  });
});
```

**TDD 开发流程**

```typescript
// Step 1: Red - 编写失败的测试
describe('PageLayout YouTube 风格重构', () => {
  it('应该渲染 YouTube 风格的顶部导航栏', () => {
    render(
      <PageLayout>
        <div>Test Content</div>
      </PageLayout>
    );

    // 验证顶部导航栏存在
    expect(screen.getByRole('banner')).toBeInTheDocument();

    // 验证搜索栏存在
    expect(screen.getByPlaceholderText('搜索影片...')).toBeInTheDocument();

    // 验证 Logo 存在
    expect(screen.getByText('KatelyaTV')).toBeInTheDocument();

    // 验证用户操作区域存在
    expect(screen.getByLabelText('Toggle theme')).toBeInTheDocument();
    expect(screen.getByLabelText('User Menu')).toBeInTheDocument();
  });
});

// Step 2: Green - 编写最少代码使测试通过
const PageLayout = ({ children, activePath = '/' }) => {
  return (
    <div className='w-full min-h-screen'>
      <header role='banner' className='fixed top-0 left-0 right-0 z-50'>
        <div className='flex items-center justify-between px-4 h-14'>
          <div className='flex items-center gap-4'>
            <span>KatelyaTV</span>
          </div>
          <div className='flex-1 max-w-2xl mx-4'>
            <input
              type='text'
              placeholder='搜索影片...'
              className='w-full h-10'
            />
          </div>
          <div className='flex items-center gap-2'>
            <button aria-label='Toggle theme'>Theme</button>
            <button aria-label='User Menu'>User</button>
          </div>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
};

// Step 3: Refactor - 重构优化代码
// 提取子组件、优化样式、添加类型定义等
```

### 1.2 YouTube 风格搜索栏

**Test Suite: YouTubeSearchBar.test.tsx**

```typescript
describe('YouTubeSearchBar Component', () => {
  describe('基础功能', () => {
    it('应该渲染搜索输入框', () => {});
    it('应该渲染搜索按钮', () => {});
    it('应该处理输入变化', () => {});
    it('应该处理搜索提交', () => {});
  });

  describe('交互行为', () => {
    it('回车键应该触发搜索', () => {});
    it('点击搜索按钮应该触发搜索', () => {});
    it('应该支持搜索历史建议', () => {});
  });

  describe('样式验证', () => {
    it('应该应用 YouTube 风格样式', () => {});
    it('聚焦时应该改变边框颜色', () => {});
  });
});
```

### 1.3 Sidebar 组件样式改造

**Test Suite: Sidebar.test.tsx**

```typescript
describe('Sidebar YouTube 风格改造', () => {
  describe('现有功能保持', () => {
    it('应该保持折叠/展开功能', () => {
      const mockOnToggle = jest.fn();
      render(<Sidebar onToggle={mockOnToggle} />);

      const toggleButton = screen.getByRole('button', { name: /toggle/i });
      fireEvent.click(toggleButton);

      expect(mockOnToggle).toHaveBeenCalledWith(true);
    });

    it('应该保持导航项功能', () => {});
    it('应该保持活跃状态指示', () => {});
  });

  describe('YouTube 风格验证', () => {
    it('应该应用深色背景', () => {});
    it('应该显示正确的图标', () => {});
    it('折叠状态应该只显示图标', () => {});
  });
});
```

## 📝 阶段二：内容组件重构 TDD

### 2.1 VideoCard 组件重构

这是最关键的组件重构，需要特别详细的测试计划。

**Test Suite: VideoCard.test.tsx**

```typescript
describe('VideoCard YouTube 风格重构', () => {
  // 测试数据
  const mockVideoCardProps = {
    id: 'test-id',
    title: '测试视频标题',
    poster: '/test-poster.jpg',
    episodes: 24,
    source_name: '测试站点',
    progress: 50,
    year: '2024',
    from: 'playrecord' as const,
    currentEpisode: 12,
    rate: '8.5',
  };

  describe('向后兼容性测试', () => {
    it('应该接受所有现有 props', () => {
      const { rerender } = render(<VideoCard {...mockVideoCardProps} />);

      // 验证组件正常渲染
      expect(screen.getByText('测试视频标题')).toBeInTheDocument();

      // 测试所有 props 组合
      rerender(<VideoCard {...mockVideoCardProps} from='douban' />);
      rerender(<VideoCard {...mockVideoCardProps} from='favorite' />);
      rerender(<VideoCard {...mockVideoCardProps} from='search' />);
    });

    it('应该保持现有事件处理逻辑', () => {
      const mockOnDelete = jest.fn();
      render(<VideoCard {...mockVideoCardProps} onDelete={mockOnDelete} />);

      // 模拟删除操作
      const deleteButton = screen.getByLabelText(/delete/i);
      fireEvent.click(deleteButton);

      expect(mockOnDelete).toHaveBeenCalled();
    });
  });

  describe('16:9 比例验证', () => {
    it('应该使用 aspect-video 比例', () => {
      render(<VideoCard {...mockVideoCardProps} />);

      const posterContainer = screen.getByRole('img').parentElement;
      expect(posterContainer).toHaveClass('aspect-video');
    });

    it('海报图片应该正确显示', () => {
      render(<VideoCard {...mockVideoCardProps} />);

      const image = screen.getByRole('img');
      expect(image).toHaveAttribute('src', '/test-poster.jpg');
      expect(image).toHaveAttribute('alt', '测试视频标题');
    });
  });

  describe('信息布局测试', () => {
    it('应该显示来源图标', () => {
      render(<VideoCard {...mockVideoCardProps} />);

      // 验证来源图标存在且显示正确的首字母
      expect(screen.getByText('测')).toBeInTheDocument();
    });

    it('应该使用水平布局', () => {
      render(<VideoCard {...mockVideoCardProps} />);

      const infoContainer = screen.getByText('测试视频标题').closest('.flex');
      expect(infoContainer).toHaveClass('flex', 'gap-3');
    });
  });

  describe('不同数据来源适配', () => {
    it('播放记录应该显示进度条', () => {
      render(
        <VideoCard {...mockVideoCardProps} from='playrecord' progress={75} />
      );

      const progressBar = screen.getByRole('progressbar');
      expect(progressBar).toHaveStyle({ width: '75%' });
    });

    it('豆瓣数据应该显示评分徽章', () => {
      render(<VideoCard {...mockVideoCardProps} from='douban' rate='9.0' />);

      expect(screen.getByText('⭐ 9.0')).toBeInTheDocument();
    });

    it('多集内容应该显示集数信息', () => {
      render(
        <VideoCard {...mockVideoCardProps} episodes={24} currentEpisode={12} />
      );

      expect(screen.getByText('12/24')).toBeInTheDocument();
    });
  });

  describe('交互行为测试', () => {
    it('悬停应该显示播放按钮', () => {
      render(<VideoCard {...mockVideoCardProps} />);

      const card = screen.getByRole('article');
      fireEvent.mouseEnter(card);

      expect(screen.getByLabelText(/play/i)).toBeInTheDocument();
    });

    it('点击应该导航到播放页面', () => {
      const mockPush = jest.fn();
      jest.mock('next/navigation', () => ({
        useRouter: () => ({ push: mockPush }),
      }));

      render(<VideoCard {...mockVideoCardProps} />);

      fireEvent.click(screen.getByRole('article'));

      expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('/play'));
    });
  });
});
```

### 2.2 VideoGrid 组件

**Test Suite: VideoGrid.test.tsx**

```typescript
describe('VideoGrid Component', () => {
  const mockVideos = Array.from({ length: 20 }, (_, i) => ({
    id: `video-${i}`,
    title: `Video ${i}`,
    poster: `/poster-${i}.jpg`,
  }));

  describe('响应式网格', () => {
    it('移动端应该显示 1 列', () => {
      // 模拟移动端视口
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 375,
      });

      render(<VideoGrid videos={mockVideos} />);

      const grid = screen.getByRole('grid');
      expect(grid).toHaveClass('grid-cols-1');
    });

    it('桌面端应该自适应列数', () => {
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 1920,
      });

      render(<VideoGrid videos={mockVideos} />);

      const grid = screen.getByRole('grid');
      expect(grid).toHaveClass('grid-cols-auto-fill');
    });
  });

  describe('虚拟滚动', () => {
    it('应该只渲染可见区域的视频卡片', () => {});
    it('滚动时应该动态加载新的卡片', () => {});
  });
});
```

### 2.3 VideoCardSkeleton 组件

**Test Suite: VideoCardSkeleton.test.tsx**

```typescript
describe('VideoCardSkeleton Component', () => {
  describe('16:9 比例骨架屏', () => {
    it('应该显示 16:9 比例的占位符', () => {
      render(<VideoCardSkeleton />);

      const skeleton = screen.getByTestId('video-skeleton');
      expect(skeleton.querySelector('.aspect-video')).toBeInTheDocument();
    });

    it('应该显示信息区域骨架', () => {
      render(<VideoCardSkeleton />);

      // 验证头像占位符
      expect(screen.getByTestId('avatar-skeleton')).toBeInTheDocument();

      // 验证文字占位符
      expect(screen.getByTestId('title-skeleton')).toBeInTheDocument();
      expect(screen.getByTestId('info-skeleton')).toBeInTheDocument();
    });

    it('应该有脉动动画效果', () => {
      render(<VideoCardSkeleton />);

      const skeleton = screen.getByTestId('video-skeleton');
      expect(skeleton).toHaveClass('animate-pulse');
    });
  });
});
```

## 📝 阶段三：样式统一和优化 TDD

### 3.1 主题色彩系统测试

**Test Suite: ThemeSystem.test.tsx**

```typescript
describe('YouTube Theme System', () => {
  describe('CSS 变量定义', () => {
    it('应该定义所有 YouTube 风格颜色变量', () => {
      const rootStyles = getComputedStyle(document.documentElement);

      expect(rootStyles.getPropertyValue('--primary-bg')).toBe('#0f0f0f');
      expect(rootStyles.getPropertyValue('--secondary-bg')).toBe('#1a1a1a');
      expect(rootStyles.getPropertyValue('--accent-red')).toBe('#ff0000');
      expect(rootStyles.getPropertyValue('--accent-blue')).toBe('#3ea6ff');
    });
  });

  describe('主题切换', () => {
    it('应该在深色和浅色主题间正确切换', () => {});
    it('应该保存用户的主题偏好', () => {});
  });
});
```

### 3.2 动画系统测试

**Test Suite: Animations.test.tsx**

```typescript
describe('Animation System', () => {
  describe('页面切换动画', () => {
    it('页面进入应该有滑入动画', () => {});
    it('卡片悬停应该有缩放效果', () => {});
  });

  describe('性能优化', () => {
    it('动画应该使用 transform 而非 layout 属性', () => {});
    it('应该支持减少动画偏好设置', () => {});
  });
});
```

## 🔄 集成测试计划

### 页面级集成测试

**Test Suite: HomePage.integration.test.tsx**

```typescript
describe('首页集成测试', () => {
  beforeEach(() => {
    // 模拟 API 响应
    setupMockServer();
  });

  describe('完整用户流程', () => {
    it('用户应该能够浏览视频并播放', async () => {
      render(<HomePage />);

      // 等待页面加载
      await waitFor(() => {
        expect(screen.getByText('热门电影')).toBeInTheDocument();
      });

      // 点击视频卡片
      const firstVideo = screen.getAllByRole('article')[0];
      fireEvent.click(firstVideo);

      // 验证导航到播放页面
      expect(mockRouter.push).toHaveBeenCalledWith(
        expect.stringContaining('/play')
      );
    });

    it('搜索功能应该正常工作', async () => {
      render(<HomePage />);

      const searchInput = screen.getByPlaceholderText('搜索影片...');
      fireEvent.change(searchInput, { target: { value: '测试电影' } });
      fireEvent.submit(searchInput);

      await waitFor(() => {
        expect(mockRouter.push).toHaveBeenCalledWith('/search?q=测试电影');
      });
    });
  });

  describe('数据加载状态', () => {
    it('加载时应该显示骨架屏', () => {
      render(<HomePage />);

      expect(screen.getAllByTestId('video-skeleton')).toHaveLength(10);
    });

    it('加载完成后应该显示实际内容', async () => {
      render(<HomePage />);

      await waitFor(() => {
        expect(screen.queryByTestId('video-skeleton')).not.toBeInTheDocument();
        expect(screen.getByText('测试电影标题')).toBeInTheDocument();
      });
    });
  });
});
```

## 📊 性能测试计划

### Lighthouse 性能基准

**Test Suite: Performance.test.ts**

```typescript
describe('性能基准测试', () => {
  describe('Core Web Vitals', () => {
    it('首次内容绘制 (FCP) 应该 < 1.5s', async () => {
      const metrics = await measurePerformance('/');
      expect(metrics.fcp).toBeLessThan(1500);
    });

    it('最大内容绘制 (LCP) 应该 < 2.5s', async () => {
      const metrics = await measurePerformance('/');
      expect(metrics.lcp).toBeLessThan(2500);
    });

    it('累积布局偏移 (CLS) 应该 < 0.1', async () => {
      const metrics = await measurePerformance('/');
      expect(metrics.cls).toBeLessThan(0.1);
    });
  });

  describe('资源加载优化', () => {
    it('图片应该延迟加载', () => {});
    it('CSS 应该内联关键样式', () => {});
    it('JavaScript 应该代码分割', () => {});
  });
});
```

## 🎭 视觉回归测试

### Storybook + Chromatic

**Stories: VideoCard.stories.tsx**

```typescript
export default {
  title: 'Components/VideoCard',
  component: VideoCard,
  parameters: {
    chromatic: {
      viewports: [375, 768, 1024, 1920],
    },
  },
} as Meta<typeof VideoCard>;

export const PlayRecord: Story = {
  args: {
    title: '测试播放记录',
    from: 'playrecord',
    progress: 75,
    episodes: 24,
    currentEpisode: 18,
  },
};

export const DoubanMovie: Story = {
  args: {
    title: '豆瓣高分电影',
    from: 'douban',
    rate: '9.2',
    year: '2024',
  },
};

export const SearchResult: Story = {
  args: {
    title: '搜索结果项',
    from: 'search',
    source_name: '测试站点',
  },
};

// 16:9 vs 2:3 比例对比
export const AspectRatioComparison: Story = {
  render: () => (
    <div className='grid grid-cols-2 gap-4'>
      <div>
        <h3>当前 2:3 比例</h3>
        <VideoCardLegacy {...PlayRecord.args} />
      </div>
      <div>
        <h3>新 16:9 比例</h3>
        <VideoCard {...PlayRecord.args} />
      </div>
    </div>
  ),
};
```

## 🎯 端到端测试

### Cypress E2E 测试

**Test Suite: youtube-ui.cy.ts**

```typescript
describe('YouTube UI 端到端测试', () => {
  beforeEach(() => {
    cy.visit('/');
  });

  describe('完整用户体验流程', () => {
    it('用户可以浏览、搜索和播放视频', () => {
      // 验证页面加载
      cy.get('[data-testid="page-layout"]').should('be.visible');

      // 验证侧边栏
      cy.get('[data-testid="sidebar"]').should('be.visible');
      cy.get('[data-testid="sidebar-toggle"]').click();
      cy.get('[data-testid="sidebar"]').should('have.class', 'collapsed');

      // 验证搜索功能
      cy.get('[data-testid="search-input"]').type('测试电影');
      cy.get('[data-testid="search-button"]').click();
      cy.url().should('include', '/search?q=测试电影');

      // 验证视频卡片点击
      cy.get('[data-testid="video-card"]').first().click();
      cy.url().should('include', '/play');
    });

    it('响应式设计在不同设备上正常工作', () => {
      // 测试移动端
      cy.viewport(375, 667);
      cy.get('[data-testid="mobile-header"]').should('be.visible');
      cy.get('[data-testid="mobile-bottom-nav"]').should('be.visible');
      cy.get('[data-testid="sidebar"]').should('not.be.visible');

      // 测试桌面端
      cy.viewport(1920, 1080);
      cy.get('[data-testid="desktop-navbar"]').should('be.visible');
      cy.get('[data-testid="sidebar"]').should('be.visible');
      cy.get('[data-testid="mobile-bottom-nav"]').should('not.be.visible');
    });
  });

  describe('视频卡片交互', () => {
    it('16:9 比例卡片应该正确显示', () => {
      cy.get('[data-testid="video-card"]')
        .first()
        .within(() => {
          // 验证 16:9 比例
          cy.get('[data-testid="video-thumbnail"]').should(
            'have.class',
            'aspect-video'
          );

          // 验证悬停效果
          cy.get('[data-testid="video-thumbnail"]').trigger('mouseover');
          cy.get('[data-testid="play-button"]').should('be.visible');

          // 验证信息布局
          cy.get('[data-testid="video-info"]').should('have.class', 'flex');
          cy.get('[data-testid="source-avatar"]').should('be.visible');
        });
    });
  });
});
```

## 📈 测试覆盖率目标

### 覆盖率基准

| 测试类型     | 目标覆盖率 | 关键指标               |
| ------------ | ---------- | ---------------------- |
| **单元测试** | 90%+       | 语句覆盖率、分支覆盖率 |
| **集成测试** | 80%+       | 组件间交互覆盖         |
| **E2E 测试** | 70%+       | 关键用户流程覆盖       |
| **视觉回归** | 100%       | 所有 UI 组件覆盖       |

### 关键组件优先级

1. **PageLayout** - 95% 覆盖率要求
2. **VideoCard** - 95% 覆盖率要求
3. **Sidebar** - 90% 覆盖率要求
4. **搜索相关组件** - 90% 覆盖率要求
5. **其他组件** - 85% 覆盖率要求

## 🔄 持续集成流程

### GitHub Actions 工作流

```yaml
# .github/workflows/tdd-workflow.yml
name: TDD Workflow

on: [push, pull_request]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npm run test:unit -- --coverage
      - uses: codecov/codecov-action@v3

  integration-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npm run test:integration

  visual-regression:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npm run chromatic

  e2e-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npm run build
      - run: npm run test:e2e
```

## 📋 TDD 开发检查清单

### 每个组件开发必须完成

- [ ] **Red**: 编写失败的测试用例
- [ ] **Green**: 编写最少代码使测试通过
- [ ] **Refactor**: 重构优化代码质量
- [ ] **向后兼容性测试**: 确保现有功能完全保持
- [ ] **响应式测试**: 验证不同屏幕尺寸下的表现
- [ ] **无障碍测试**: 验证 ARIA 标签和键盘导航
- [ ] **性能测试**: 验证渲染性能和内存使用
- [ ] **视觉回归测试**: 创建 Storybook stories

### 每个 PR 提交前检查

- [ ] 所有单元测试通过
- [ ] 所有集成测试通过
- [ ] 代码覆盖率达到目标
- [ ] 无 TypeScript 错误
- [ ] 无 ESLint 警告
- [ ] Chromatic 视觉回归测试通过
- [ ] 性能指标符合要求

## 🎯 测试成功标准

### 功能完整性

- ✅ 所有现有功能完全保持
- ✅ 新 UI 功能正常工作
- ✅ 向后兼容性 100%

### 质量标准

- ✅ 测试覆盖率 > 85%
- ✅ 零回归 bug
- ✅ 性能指标达标
- ✅ 无障碍标准符合

### 用户体验

- ✅ 响应式设计完美
- ✅ 交互流畅自然
- ✅ 加载性能优秀
- ✅ 视觉效果统一

---

**文档版本**: v1.0  
**创建日期**: 2025 年 9 月 8 日  
**最后更新**: 2025 年 9 月 8 日  
**负责人**: KatelyaTV 开发团队

这个 TDD 计划确保 YouTube 风格重构的每一步都有可靠的测试保障，维护代码质量和系统稳定性。
