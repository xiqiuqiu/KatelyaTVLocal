import { shouldShowMarkAdControl } from './ad-skip-mark-control';

describe('shouldShowMarkAdControl', () => {
  it('shows the mark control while undo toast is hidden', () => {
    expect(
      shouldShowMarkAdControl({
        undoToastVisible: false,
      })
    ).toBe(true);
  });

  it('hides mark control while undo toast is visible', () => {
    expect(
      shouldShowMarkAdControl({
        undoToastVisible: true,
      })
    ).toBe(false);
  });
});
