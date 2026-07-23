import { act, render } from '@testing-library/react';

import PlaybackDebugPlayhead from './PlaybackDebugPlayhead';

describe('PlaybackDebugPlayhead', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('shows the initial ref value', () => {
    const currentTimeRef = { current: 125.7 };
    const { container } = render(
      <PlaybackDebugPlayhead currentTimeRef={currentTimeRef} />
    );

    expect(container).toHaveTextContent('位置：2:05');
  });

  it('updates from the ref once per second', () => {
    const currentTimeRef = { current: 0 };
    const { container } = render(
      <PlaybackDebugPlayhead currentTimeRef={currentTimeRef} />
    );

    expect(container).toHaveTextContent('位置：0:00');

    currentTimeRef.current = 61.2;
    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(container).toHaveTextContent('位置：1:01');
  });

  it('clears the interval on unmount', () => {
    const clearIntervalSpy = jest.spyOn(window, 'clearInterval');
    const currentTimeRef = { current: 0 };
    const { unmount } = render(
      <PlaybackDebugPlayhead currentTimeRef={currentTimeRef} />
    );

    unmount();

    expect(clearIntervalSpy).toHaveBeenCalled();
    clearIntervalSpy.mockRestore();
  });
});
