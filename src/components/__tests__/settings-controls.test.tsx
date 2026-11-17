import { fireEvent, render, screen } from '@testing-library/react';

import SettingsRow from '@/components/ui/SettingsRow';
import Switch from '@/components/ui/Switch';

describe('settings controls', () => {
  it('toggles the switch through role=switch', () => {
    const onChange = jest.fn();
    render(
      <Switch checked={false} label='深色外观' onCheckedChange={onChange} />
    );

    const control = screen.getByRole('switch', { name: '深色外观' });
    expect(control).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(control);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('keeps the row accessible name to the title only', () => {
    render(
      <SettingsRow
        href='/history'
        title='播放历史'
        description='继续上次看到的进度'
      />
    );

    expect(screen.getByRole('link', { name: '播放历史' })).toHaveAttribute(
      'href',
      '/history'
    );
  });

  it('renders a button row for actions', () => {
    const onClick = jest.fn();
    render(<SettingsRow onClick={onClick} title='修改密码' />);

    fireEvent.click(screen.getByRole('button', { name: '修改密码' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
