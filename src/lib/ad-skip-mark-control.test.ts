import { shouldShowMarkAdControl } from './ad-skip-mark-control';

describe('shouldShowMarkAdControl', () => {
  it('hides while playing with controls auto-hidden', () => {
    expect(
      shouldShowMarkAdControl({
        controlsVisible: false,
        paused: false,
        undoToastVisible: false,
      })
    ).toBe(false);
  });

  it('shows when player controls are visible', () => {
    expect(
      shouldShowMarkAdControl({
        controlsVisible: true,
        paused: false,
        undoToastVisible: false,
      })
    ).toBe(true);
  });

  it('shows while paused even if controls report hidden', () => {
    expect(
      shouldShowMarkAdControl({
        controlsVisible: false,
        paused: true,
        undoToastVisible: false,
      })
    ).toBe(true);
  });

  it('hides mark control while undo toast is visible', () => {
    expect(
      shouldShowMarkAdControl({
        controlsVisible: true,
        paused: true,
        undoToastVisible: true,
      })
    ).toBe(false);
  });
});
