/**
 * Visibility policy for the manual "mark ad and skip" control.
 *
 * The control lives inside ArtPlayer's control bar, which already hides with
 * the bar. Do not gate on controlsVisible/paused — forcing display:none from
 * a stale control event makes the button visible-but-dead (or missing) on iOS
 * WebKit while neighboring ArtPlayer controls still work.
 */
export function shouldShowMarkAdControl(input: {
  undoToastVisible: boolean;
}): boolean {
  return !input.undoToastVisible;
}
