/**
 * Shared pill-switch styling: darker off-track so toggles stay visible on #f4f7f9 and white cards.
 */
export const switchTrackColors = { false: '#94a3b8', true: '#4a8fb0' } as const;

export function switchThumbColor(isOn: boolean, primaryColor: string) {
  return isOn ? primaryColor : '#ffffff';
}
