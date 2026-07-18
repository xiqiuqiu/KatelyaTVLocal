/**
 * Visibility policy for the manual "mark ad and skip" control.
 * Keep the crowd-source entry discoverable without permanently covering video.
 */
export function shouldShowMarkAdControl(input: {
  controlsVisible: boolean;
  paused: boolean;
  undoToastVisible: boolean;
}): boolean {
  if (input.undoToastVisible) {
    return false;
  }
  return input.controlsVisible || input.paused;
}
