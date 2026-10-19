import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { useRef } from 'react';

import TvSearchForm from '@/components/TvSearchForm';
import AppShell from '@/components/ui/AppShell';
import useTvBrowseNavigation from '@/components/useTvBrowseNavigation';

jest.mock('@/components/UserMenu', () => ({ UserMenu: () => null }));
jest.mock('@/components/TopSearchBar', () => () => <div>网页搜索栏</div>);
jest.mock('@/components/Sidebar', () => () => <div>网页侧栏</div>);
jest.mock('@/components/MobileBottomNav', () => () => <div>手机导航</div>);

function rect(left: number, top: number) {
  return {
    x: left,
    y: top,
    left,
    top,
    width: 100,
    height: 50,
    right: left + 100,
    bottom: top + 50,
    toJSON: () => ({}),
  };
}

function ManagedForm({
  enabled = true,
  onSubmit = jest.fn(),
  manageInputs = true,
}: {
  enabled?: boolean;
  onSubmit?: () => void;
  manageInputs?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  useTvBrowseNavigation(rootRef, enabled, '/admin', manageInputs);
  return (
    <div ref={rootRef}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <label>
          站点名称
          <input
            data-tv-primary
            data-tv-focus-key='managed-name'
            defaultValue='KatelyaTV'
          />
        </label>
        <label>
          站点说明
          <textarea
            data-tv-focus-key='managed-description'
            defaultValue='私人放映厅'
          />
        </label>
        <label>
          默认分类
          <select data-tv-focus-key='managed-category' defaultValue='movie'>
            <option value='movie'>电影</option>
            <option value='tv'>剧集</option>
          </select>
        </label>
        <label>
          允许注册
          <input type='checkbox' data-tv-focus-key='managed-checkbox' />
        </label>
        <label>
          只读标识
          <input readOnly data-tv-focus-key='managed-readonly' value='owner' />
        </label>
        <button type='submit' data-tv-focus-key='managed-submit'>
          保存配置
        </button>
      </form>
    </div>
  );
}

describe('TV browse interaction', () => {
  const clickA = jest.fn();
  const clickB = jest.fn();
  const originalScroll = HTMLElement.prototype.scrollIntoView;

  beforeEach(() => {
    sessionStorage.clear();
    clickA.mockReset();
    clickB.mockReset();
    HTMLElement.prototype.scrollIntoView = jest.fn();
    jest
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        if (this.dataset.tvFocusKey?.startsWith('managed-')) {
          const index = [
            'name',
            'description',
            'category',
            'checkbox',
            'readonly',
            'submit',
          ].indexOf(this.dataset.tvFocusKey.slice(8));
          return rect(0, 100 + index * 100);
        }
        if (this.dataset.tvFocusKey === 'card-a') return rect(0, 100);
        if (this.dataset.tvFocusKey === 'card-b') return rect(150, 100);
        if (this.dataset.tvFocusKey === 'nav-exit') return rect(190, 0);
        if (this.dataset.tvFocusKey === 'search-input') return rect(0, 100);
        if (this.dataset.tvFocusKey === 'search-submit') return rect(150, 100);
        return rect(0, 0);
      });
  });

  afterEach(() => {
    window.history.replaceState(null, '', '/');
    document
      .querySelectorAll('[role="dialog"][aria-modal="true"]')
      .forEach((modal) => modal.remove());
    jest.restoreAllMocks();
    HTMLElement.prototype.scrollIntoView = originalScroll;
  });

  const cards = (
    <>
      <button data-tv-focus-key='card-a' data-tv-primary onClick={clickA}>
        影片甲
      </button>
      <button data-tv-focus-key='card-b' onClick={clickB}>
        影片乙
      </button>
      <button disabled>不可播放</button>
      <button hidden>隐藏操作</button>
    </>
  );

  it('focuses a requested admin section after loading instead of restoring the navigation', async () => {
    window.history.replaceState(
      null,
      '',
      '/admin?section=videoSource&tv=1#admin-videoSource'
    );
    sessionStorage.setItem('tv-browse-focus:/admin', 'nav-home');
    const view = render(
      <AppShell activePath='/admin' tvMode>
        <p>加载中</p>
      </AppShell>
    );
    await waitFor(() =>
      expect(screen.getByRole('link', { name: '首页' })).toHaveFocus()
    );
    view.rerender(
      <AppShell activePath='/admin' tvMode>
        <section id='admin-videoSource'>
          <button>视频源配置</button>
        </section>
      </AppShell>
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '视频源配置' })).toHaveFocus()
    );
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({
      block: 'nearest',
      inline: 'nearest',
    });
  });

  it('reveals the current selection even when a direction has no next target, without activating it', async () => {
    const view = render(
      <AppShell tvMode>
        {cards}
        <p>加载中</p>
      </AppShell>
    );
    const a = screen.getByRole('button', { name: '影片甲' });
    await waitFor(() => expect(a).toHaveFocus());
    expect(document.documentElement).toHaveClass('tv-browse-navigation');
    const scroll = jest.mocked(HTMLElement.prototype.scrollIntoView);
    scroll.mockClear();
    view.rerender(
      <AppShell tvMode>
        {cards}
        <p>
          <span>加载完成</span>
        </p>
      </AppShell>
    );
    await waitFor(() => expect(scroll).toHaveBeenCalled());
    expect(a).toHaveFocus();
    scroll.mockClear();
    // Browser scroll restoration can leave the focused control off screen.
    fireEvent.keyDown(a, { key: 'ArrowLeft' });
    expect(a).toHaveFocus();
    expect(scroll).toHaveBeenCalledWith({
      block: 'nearest',
      inline: 'nearest',
    });
    expect(clickA).not.toHaveBeenCalled();
    view.unmount();
    expect(document.documentElement).not.toHaveClass('tv-browse-navigation');
  });

  it('moves focus without acting, confirms once despite the remote virtual click, and preserves navigation links', async () => {
    render(<AppShell tvMode>{cards}</AppShell>);
    const a = screen.getByRole('button', { name: '影片甲' });
    const b = screen.getByRole('button', { name: '影片乙' });
    await waitFor(() => expect(a).toHaveFocus());
    fireEvent.keyDown(a, { key: 'ArrowRight' });
    expect(b).toHaveFocus();
    fireEvent.keyDown(b, { key: 'ArrowRight' });
    expect(b).toHaveFocus();
    expect(clickA).not.toHaveBeenCalled();
    expect(clickB).not.toHaveBeenCalled();
    fireEvent.keyDown(b, { key: 'Enter' });
    const pointer = new Event('pointerdown', { bubbles: true });
    Object.defineProperty(pointer, 'pointerType', { value: '' });
    fireEvent(a, pointer);
    fireEvent.click(a, { detail: 1 });
    expect(clickB).toHaveBeenCalledTimes(1);
    expect(clickA).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('tv-browse-focus:/')).toBe('card-b');
    expect(screen.getByRole('link', { name: '播放历史' })).toHaveAttribute(
      'href',
      '/history?tv=1'
    );
    expect(screen.queryByText('网页搜索栏')).not.toBeInTheDocument();
  });

  it('redirects pointer-only confirmation and restores the remembered card after asynchronous content returns', async () => {
    const view = render(<AppShell tvMode>{cards}</AppShell>);
    const b = screen.getByRole('button', { name: '影片乙' });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '影片甲' })).toHaveFocus()
    );
    fireEvent.keyDown(document.activeElement || document.body, {
      key: 'ArrowRight',
    });
    const pointer = new Event('pointerdown', { bubbles: true });
    Object.defineProperty(pointer, 'pointerType', { value: '' });
    fireEvent(document.body, pointer);
    fireEvent.click(document.body, { detail: 1 });
    expect(clickB).toHaveBeenCalledTimes(1);
    expect(b).toHaveFocus();
    view.unmount();
    const returning = render(
      <AppShell tvMode>
        <p>加载中</p>
      </AppShell>
    );
    returning.rerender(<AppShell tvMode>{cards}</AppShell>);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '影片乙' })).toHaveFocus()
    );
  });

  it('contains remote navigation in a portal confirmation and cancels on focus escape without activating the background', async () => {
    render(
      <AppShell tvMode activePath='/history'>
        {cards}
      </AppShell>
    );
    const a = screen.getByRole('button', { name: '影片甲' });
    await waitFor(() => expect(a).toHaveFocus());
    const modal = document.createElement('div');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.innerHTML =
      '<button class="swal2-cancel">取消</button><button>确认删除</button>';
    const cancel = modal.querySelector<HTMLButtonElement>('button');
    if (!cancel) throw new Error('missing cancel button');
    const cancelled = jest.fn(() => modal.remove());
    cancel.addEventListener('click', cancelled);
    act(() => {
      document.body.appendChild(modal);
      cancel.focus();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
    act(() => {
      a.focus();
    });
    await waitFor(() => expect(cancelled).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(a).toHaveFocus());
    expect(clickA).not.toHaveBeenCalled();
    expect(clickB).not.toHaveBeenCalled();
  });

  it('leaves Web Mode and the validated playback keyboard handling untouched', () => {
    const view = render(<AppShell>{cards}</AppShell>);
    expect(screen.getByText('网页搜索栏')).toBeInTheDocument();
    view.rerender(
      <AppShell tvMode activePath='/play'>
        {cards}
      </AppShell>
    );
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
      cancelable: true,
    });
    fireEvent(screen.getByRole('button', { name: '影片甲' }), event);
    expect(event.defaultPrevented).toBe(false);
  });

  it.each([
    { key: 'BrowserBack' },
    { key: 'Unidentified', keyCode: 4 },
    { key: 'Escape' },
  ])(
    'dismisses a marked dialog on remote back %p and restores its opener',
    async (key) => {
      render(
        <AppShell tvMode activePath='/search'>
          {cards}
        </AppShell>
      );
      const a = screen.getByRole('button', { name: '影片甲' });
      await waitFor(() => expect(a).toHaveFocus());
      fireEvent.keyDown(a, { key: 'Enter' });
      const modal = document.createElement('div');
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.innerHTML = '<button data-tv-back>返回</button>';
      const cancel = modal.querySelector<HTMLButtonElement>('button');
      if (!cancel) throw new Error('missing cancel button');
      const cancelled = jest.fn(() => modal.remove());
      cancel.addEventListener('click', cancelled);
      act(() => {
        document.body.appendChild(modal);
        cancel.focus();
      });
      fireEvent.keyDown(cancel, key);
      expect(cancelled).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(a).toHaveFocus());
      expect(clickA).toHaveBeenCalledTimes(1);
    }
  );

  it('dismisses a marked dialog on focus-only back even before the mutation recovery runs', async () => {
    render(
      <AppShell tvMode activePath='/search'>
        {cards}
      </AppShell>
    );
    const a = screen.getByRole('button', { name: '影片甲' });
    const b = screen.getByRole('button', { name: '影片乙' });
    await waitFor(() => expect(a).toHaveFocus());
    const modal = document.createElement('div');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.innerHTML = '<button data-tv-back>返回</button>';
    const cancel = modal.querySelector<HTMLButtonElement>('button');
    if (!cancel) throw new Error('missing cancel button');
    cancel.addEventListener('click', () => modal.remove());
    act(() => {
      document.body.appendChild(modal);
      cancel.focus();
      b.focus();
    });
    await waitFor(() => expect(modal).not.toBeInTheDocument());
    await waitFor(() => expect(a).toHaveFocus());
    expect(clickB).not.toHaveBeenCalled();
  });

  it.each([1280, 1587])(
    'reaches the full-width search input from mode and history at width %i',
    async (width) => {
      jest
        .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
        .mockImplementation(function (this: HTMLElement) {
          const key = this.dataset.tvFocusKey;
          if (key === 'search-mode:normal')
            return { ...rect(20, 214), width: 122, right: 142 };
          if (key === 'search-input')
            return { ...rect(20, 332), width: width - 168, right: width - 148 };
          if (key === 'search-submit') return rect(width - 132, 333);
          if (key === 'search-history')
            return { ...rect(41, 549), width: 66, right: 107 };
          return rect(0, 0);
        });
      const onSearch = jest.fn();
      render(
        <AppShell tvMode activePath='/search'>
          <button data-tv-focus-key='search-mode:normal'>普通搜索</button>
          <TvSearchForm initialQuery='' onSearch={onSearch} />
          <button data-tv-focus-key='search-history'>搜索历史影片</button>
        </AppShell>
      );
      const input = screen.getByRole('searchbox');
      await waitFor(() => expect(input).toHaveFocus());
      const mode = screen.getByRole('button', { name: '普通搜索' });
      act(() => mode.focus());
      fireEvent.keyDown(mode, { key: 'ArrowDown' });
      expect(input).toHaveFocus();
      const history = screen.getByRole('button', { name: '搜索历史影片' });
      act(() => history.focus());
      fireEvent.keyDown(history, { key: 'ArrowUp' });
      expect(input).toHaveFocus();
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(input).not.toHaveAttribute('readonly');
      expect(onSearch).not.toHaveBeenCalled();
    }
  );

  it('separates TV form navigation from native input editing and protects IME confirmation', async () => {
    const onSearch = jest.fn();
    render(
      <AppShell tvMode activePath='/search' modeHref='/search?q=test&tv=1'>
        <TvSearchForm initialQuery='test' onSearch={onSearch} />
      </AppShell>
    );
    const input = screen.getByRole('searchbox');
    await waitFor(() => expect(input).toHaveFocus());
    expect(input).toHaveAttribute('readonly');
    fireEvent.keyDown(input, { key: 'ArrowRight' });
    expect(screen.getByRole('button', { name: '搜索' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement || document.body, {
      key: 'ArrowLeft',
    });
    expect(input).toHaveFocus();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input).not.toHaveAttribute('readonly');
    const caret = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
      cancelable: true,
    });
    fireEvent(input, caret);
    expect(caret.defaultPrevented).toBe(false);
    expect(input).toHaveFocus();
    const composing = new KeyboardEvent('keydown', {
      key: 'Enter',
      isComposing: true,
      bubbles: true,
      cancelable: true,
    });
    fireEvent(input, composing);
    expect(composing.defaultPrevented).toBe(true);
    expect(onSearch).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute('readonly');
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getByRole('button', { name: '搜索' })).toHaveFocus();
    expect(input).toHaveAttribute('readonly');
    expect(screen.getByRole('link', { name: '退出电视模式' })).toHaveAttribute(
      'href',
      '/search?q=test&tv=0'
    );
    expect(screen.getByRole('link', { name: '搜索' })).toHaveAttribute(
      'href',
      '/search?tv=1'
    );
  });

  it.each([
    { key: 'Enter' },
    { key: 'Escape' },
    { key: 'BrowserBack' },
    { key: 'Unidentified', keyCode: 4 },
  ])(
    'edits a managed input and ends with %p without submitting or moving its focus',
    async (back) => {
      const submit = jest.fn();
      render(<ManagedForm onSubmit={submit} />);
      const input = screen.getByRole('textbox', { name: '站点名称' });
      await waitFor(() => expect(input).toHaveFocus());
      expect(input).toHaveAttribute('readonly');
      expect(input).toHaveAttribute('data-tv-input');
      const enter = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      });
      fireEvent(input, enter);
      expect(enter.defaultPrevented).toBe(true);
      expect(input).not.toHaveAttribute('readonly');
      expect(input).toHaveAttribute('data-tv-editing', 'true');
      fireEvent.change(input, { target: { value: '新的站点名称' } });
      const arrow = new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        bubbles: true,
        cancelable: true,
      });
      fireEvent(input, arrow);
      expect(arrow.defaultPrevented).toBe(false);
      expect(input).toHaveFocus();
      const end = new KeyboardEvent('keydown', {
        ...back,
        bubbles: true,
        cancelable: true,
      });
      fireEvent(input, end);
      expect(end.defaultPrevented).toBe(true);
      expect(input).toHaveFocus();
      expect(input).toHaveAttribute('readonly');
      expect(input).not.toHaveAttribute('data-tv-editing');
      expect(input).toHaveValue('新的站点名称');
      expect(submit).not.toHaveBeenCalled();
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      expect(screen.getByRole('textbox', { name: '站点说明' })).toHaveFocus();
    }
  );

  it.each(['Enter', 'BrowserBack'])(
    'ignores the remote virtual click after ending a long edit with %s',
    async (key) => {
      const submit = jest.fn();
      const now = jest.spyOn(Date, 'now').mockReturnValue(1000);
      render(<ManagedForm onSubmit={submit} />);
      const input = screen.getByRole('textbox', { name: '站点名称' });
      await waitFor(() => expect(input).toHaveFocus());
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(input).not.toHaveAttribute('readonly');
      fireEvent.change(input, { target: { value: '已修改的站点' } });
      now.mockReturnValue(2000);
      fireEvent.keyDown(input, { key });
      expect(input).toHaveAttribute('readonly');
      now.mockReturnValue(2060);
      const pointer = new Event('pointerdown', { bubbles: true });
      Object.defineProperty(pointer, 'pointerType', { value: '' });
      fireEvent(document.body, pointer);
      fireEvent.click(document.body, { detail: 1 });
      expect(input).toHaveAttribute('readonly');
      expect(input).not.toHaveAttribute('data-tv-editing');
      expect(input).toHaveFocus();
      expect(input).toHaveValue('已修改的站点');
      expect(submit).not.toHaveBeenCalled();
    }
  );

  it('reaches textarea and select, preserving their native editing and explicit form submission', async () => {
    const submit = jest.fn();
    render(<ManagedForm onSubmit={submit} />);
    const input = screen.getByRole('textbox', { name: '站点名称' });
    const description = screen.getByRole('textbox', { name: '站点说明' });
    const category = screen.getByRole('combobox', { name: '默认分类' });
    await waitFor(() => expect(input).toHaveFocus());
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(description).toHaveFocus();
    expect(description).toHaveAttribute('readonly');
    fireEvent.keyDown(description, { key: 'Enter' });
    expect(description).not.toHaveAttribute('readonly');
    fireEvent.change(description, { target: { value: '第一行\n第二行' } });
    const textareaArrow = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true,
    });
    fireEvent(description, textareaArrow);
    expect(textareaArrow.defaultPrevented).toBe(false);
    expect(description).toHaveFocus();
    fireEvent.keyDown(description, { key: 'Enter' });
    expect(description).toHaveAttribute('readonly');
    expect(description).toHaveValue('第一行\n第二行');
    fireEvent.keyDown(description, { key: 'ArrowDown' });
    expect(category).toHaveFocus();
    fireEvent.keyDown(category, { key: 'Enter' });
    expect(category).toHaveAttribute('data-tv-editing', 'true');
    const selectArrow = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true,
    });
    fireEvent(category, selectArrow);
    expect(selectArrow.defaultPrevented).toBe(false);
    expect(category).toHaveFocus();
    fireEvent.change(category, { target: { value: 'tv' } });
    fireEvent.keyDown(category, { key: 'Enter' });
    expect(category).not.toHaveAttribute('data-tv-editing');
    expect(category).toHaveValue('tv');
    expect(submit).not.toHaveBeenCalled();
    const save = screen.getByRole('button', { name: '保存配置' });
    act(() => save.focus());
    fireEvent.keyDown(save, { key: 'Enter' });
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('toggles checkboxes while preserving explicit readOnly controls', async () => {
    render(<ManagedForm />);
    const input = screen.getByRole('textbox', { name: '站点名称' });
    await waitFor(() => expect(input).toHaveFocus());
    const checkbox = screen.getByRole('checkbox', { name: '允许注册' });
    act(() => checkbox.focus());
    fireEvent.keyDown(checkbox, { key: 'Enter' });
    expect(checkbox).toBeChecked();
    expect(checkbox).not.toHaveAttribute('data-tv-editing');
    fireEvent.keyDown(checkbox, { key: 'Enter' });
    expect(checkbox).not.toBeChecked();
    fireEvent.keyDown(checkbox, { key: 'ArrowDown' });
    const readonly = screen.getByRole('textbox', { name: '只读标识' });
    expect(readonly).toHaveFocus();
    fireEvent.keyDown(readonly, { key: 'Enter' });
    expect(readonly).toHaveAttribute('readonly');
    expect(readonly).not.toHaveAttribute('data-tv-editing');
    expect(readonly).toHaveValue('owner');
  });

  it('restores original field attributes when leaving TV while editing', async () => {
    const view = render(<ManagedForm />);
    const input = screen.getByRole('textbox', { name: '站点名称' });
    const description = screen.getByRole('textbox', { name: '站点说明' });
    const category = screen.getByRole('combobox', { name: '默认分类' });
    const readonly = screen.getByRole('textbox', { name: '只读标识' });
    await waitFor(() => expect(input).toHaveFocus());
    fireEvent.keyDown(input, { key: 'Enter' });
    view.rerender(<ManagedForm enabled={false} />);
    for (const control of [input, description, category, readonly]) {
      expect(control).not.toHaveAttribute('data-tv-input');
      expect(control).not.toHaveAttribute('data-tv-editing');
    }
    expect(input).not.toHaveAttribute('readonly');
    expect(description).not.toHaveAttribute('readonly');
    expect(readonly).toHaveAttribute('readonly');
    expect(document.documentElement).not.toHaveClass('tv-browse-navigation');
  });

  it('registers dynamic portal fields and finishes editing before canceling the modal on Back', async () => {
    render(<ManagedForm />);
    const opener = screen.getByRole('textbox', { name: '站点名称' });
    await waitFor(() => expect(opener).toHaveFocus());
    const modal = document.createElement('div');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.innerHTML =
      '<input aria-label="新增来源" /><button data-tv-back>取消新增</button>';
    const field = modal.querySelector<HTMLInputElement>('input');
    const cancel = modal.querySelector<HTMLButtonElement>('button');
    if (!field || !cancel) throw new Error('missing modal controls');
    const cancelled = jest.fn(() => modal.remove());
    cancel.addEventListener('click', cancelled);
    act(() => {
      document.body.appendChild(modal);
    });
    await waitFor(() => expect(field).toHaveAttribute('data-tv-input'));
    act(() => field.focus());
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(field).not.toHaveAttribute('readonly');
    fireEvent.keyDown(field, { key: 'BrowserBack' });
    expect(field).toHaveAttribute('readonly');
    expect(modal).toBeInTheDocument();
    expect(cancelled).not.toHaveBeenCalled();
    fireEvent.keyDown(field, { key: 'BrowserBack' });
    expect(cancelled).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it('manages embedded admin inputs without taking over ordinary page inputs', async () => {
    render(<ManagedForm manageInputs={false} />);
    const pageField = screen.getByRole('textbox', { name: '站点名称' });
    const modal = document.createElement('div');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.innerHTML =
      '<div data-admin-settings><input aria-label="内嵌站点名称" /></div><button data-tv-back>关闭设置</button>';
    act(() => {
      document.body.appendChild(modal);
    });
    const input = screen.getByRole('textbox', { name: '内嵌站点名称' });
    await waitFor(() => expect(input).toHaveAttribute('data-tv-input'));
    expect(pageField).not.toHaveAttribute('data-tv-input');
    act(() => input.focus());
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input).not.toHaveAttribute('readonly');
    fireEvent.keyDown(input, { key: 'BrowserBack' });
    expect(input).toHaveAttribute('readonly');
    expect(modal).toBeInTheDocument();
  });

  it('prioritizes a nested admin confirmation over the settings dialog', async () => {
    render(<ManagedForm />);
    const settings = document.createElement('div');
    settings.setAttribute('role', 'dialog');
    settings.setAttribute('aria-modal', 'true');
    settings.innerHTML = '<button data-tv-back>关闭设置</button>';
    const close = jest.fn();
    settings.querySelector('button')?.addEventListener('click', close);
    const confirmation = document.createElement('div');
    confirmation.className = 'swal2-popup ui-admin-dialog';
    confirmation.setAttribute('role', 'dialog');
    confirmation.setAttribute('aria-modal', 'true');
    confirmation.innerHTML = '<button class="swal2-cancel">取消确认</button>';
    const cancel = jest.fn(() => confirmation.remove());
    const button = confirmation.querySelector('button');
    if (!button) throw new Error('missing confirmation');
    button.addEventListener('click', cancel);
    act(() => {
      document.body.append(settings, confirmation);
      button.focus();
    });
    fireEvent.keyDown(button, { key: 'BrowserBack' });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
    expect(settings).toBeInTheDocument();
  });

  it('redirects virtual confirmation to the TV input without activating an unrelated control', async () => {
    const onSearch = jest.fn();
    render(
      <AppShell tvMode activePath='/search'>
        <TvSearchForm initialQuery='' onSearch={onSearch} />
      </AppShell>
    );
    const input = screen.getByRole('searchbox');
    await waitFor(() => expect(input).toHaveFocus());
    const pointer = new Event('pointerdown', { bubbles: true });
    Object.defineProperty(pointer, 'pointerType', { value: '' });
    fireEvent(document.body, pointer);
    fireEvent.click(document.body, { detail: 1 });
    expect(input).not.toHaveAttribute('readonly');
    expect(onSearch).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '  庆余年  ' } });
    fireEvent.submit(screen.getByRole('search', { name: '电视搜索' }));
    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(onSearch).toHaveBeenCalledWith('庆余年');
  });
});
