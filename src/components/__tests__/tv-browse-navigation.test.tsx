import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

import AppShell from '@/components/ui/AppShell';

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
        if (this.dataset.tvFocusKey === 'card-a') return rect(0, 100);
        if (this.dataset.tvFocusKey === 'card-b') return rect(150, 100);
        if (this.dataset.tvFocusKey === 'nav-exit') return rect(190, 0);
        return rect(0, 0);
      });
  });

  afterEach(() => {
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
    expect(screen.getByRole('link', { name: '电视模式' })).toHaveAttribute(
      'href',
      '/?tv=1'
    );
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
});
