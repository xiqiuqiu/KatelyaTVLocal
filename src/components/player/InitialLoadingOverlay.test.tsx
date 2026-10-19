import { fireEvent, render, screen } from '@testing-library/react';

import InitialLoadingOverlay from './InitialLoadingOverlay';

const back = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ back }) }));

describe('InitialLoadingOverlay', () => {
  it('shows one neutral preparation state without exposing source internals', () => {
    render(<InitialLoadingOverlay title='庆余年' />);

    expect(screen.getByRole('status')).toHaveTextContent('正在准备播放');
    expect(screen.getByText('庆余年')).toBeInTheDocument();
    expect(
      screen.queryByText(/搜源|线路|优选|获取详情/)
    ).not.toBeInTheDocument();
    expect(
      document.querySelector('[data-playback-preparation-target]')
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '返回上一页' }));
    expect(back).toHaveBeenCalledTimes(1);
  });
});
