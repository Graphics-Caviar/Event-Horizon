/**
 * src/components/AbilityList/icons.js
 *
 * One small abstract SVG glyph per ability id. Kept deliberately simple
 * and geometric (not literal illustrations) so they read clearly at badge
 * size and match the HUD's angular visual language. New abilities just
 * need an entry here — falls back to a generic diamond if missing.
 */

const ICONS = {
  afterburn: '<path d="M12 2 L15 10 L21 12 L15 14 L12 22 L9 14 L3 12 L9 10 Z" />',
  'precision-shot': '<circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="12" cy="12" r="1.6"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4" stroke="currentColor" stroke-width="1.4"/>',
  'evasive-roll': '<path d="M4 12a8 8 0 1 1 3 6.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M4 12l3-3M4 12l3 3" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  'salvage-expert': '<path d="M4 8l8-4 8 4-8 4-8-4Z" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M4 8v8l8 4 8-4V8" fill="none" stroke="currentColor" stroke-width="1.4"/>',
  'repair-drone': '<circle cx="12" cy="10" r="4" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M4 20c0-3 3-5 8-5s8 2 8 5" fill="none" stroke="currentColor" stroke-width="1.4"/>',
  hacker: '<rect x="4" y="6" width="16" height="12" rx="1" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 10l-2 2 2 2M16 10l2 2-2 2M13 9l-2 6" stroke="currentColor" stroke-width="1.2"/>',
  'gravity-shift': '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2 3"/><circle cx="12" cy="12" r="2.4" />',
  'phase-step': '<path d="M5 12h5l-2-3M10 12l-2 3" stroke="currentColor" stroke-width="1.5" fill="none"/><path d="M14 12h5M17 9l2 3-2 3" stroke="currentColor" stroke-width="1.5" fill="none" opacity="0.5"/>',
  'void-shield': '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z" fill="none" stroke="currentColor" stroke-width="1.4"/>',
};

const FALLBACK = '<path d="M12 2l10 10-10 10L2 12Z" fill="none" stroke="currentColor" stroke-width="1.4"/>';

export function abilityIconSvg(iconId) {
  const inner = ICONS[iconId] ?? FALLBACK;
  return `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
}
