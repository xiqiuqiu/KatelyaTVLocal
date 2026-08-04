import { render, screen } from '@testing-library/react';

import InitialLoadingOverlay from './InitialLoadingOverlay';

describe('InitialLoadingOverlay', () => {
  it('shows one neutral preparation state without exposing source internals', () => {
    render(<InitialLoadingOverlay title='庆余年' />);

    expect(screen.getByRole('status')).toHaveTextContent('正在准备播放');
    expect(screen.getByText('庆余年')).toBeInTheDocument();
    expect(
      screen.queryByText(/搜源|线路|优选|获取详情/)
    ).not.toBeInTheDocument();
  });
});
