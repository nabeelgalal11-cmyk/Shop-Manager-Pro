/**
 * Semantic design tokens for the mobile app.
 *
 * These tokens mirror the naming conventions used in web artifacts (index.css)
 * so that multi-artifact projects share a cohesive visual identity.
 *
 * Replace the placeholder values below with values that match the project's
 * brand. If a sibling web artifact exists, read its index.css and convert the
 * HSL values to hex so both artifacts use the same palette.
 *
 * To add dark mode, add a `dark` key with the same token names.
 * The useColors() hook will automatically pick it up.
 */

const colors = {
  light: {
    // Legacy aliases (kept for backward compatibility)
    text: '#0f172a',
    tint: '#2563eb',

    // Core surfaces
    background: '#f8fafc',
    foreground: '#0f172a',

    // Cards / elevated surfaces
    card: '#ffffff',
    cardForeground: '#0f172a',

    // Primary action color (buttons, links, active states)
    primary: '#2563eb',
    primaryForeground: '#f8fafc',

    // Secondary / less-emphasis interactive surfaces
    secondary: '#e2e8f0',
    secondaryForeground: '#0f172a',

    // Muted / subdued elements (dividers, timestamps, placeholders)
    muted: '#f1f5f9',
    mutedForeground: '#64748b',

    // Accent highlights (badges, selected items, focus rings)
    accent: '#e2e8f0',
    accentForeground: '#0f172a',

    // Destructive actions (delete, error states)
    destructive: '#ef4444',
    destructiveForeground: '#ffffff',

    // Borders and input outlines
    border: '#e2e8f0',
    input: '#e2e8f0',
  },
  dark: {
    text: '#f8fafc',
    tint: '#2563eb',
    background: '#0f172a',
    foreground: '#f8fafc',
    card: '#0f172a',
    cardForeground: '#f8fafc',
    primary: '#2563eb',
    primaryForeground: '#f8fafc',
    secondary: '#1e293b',
    secondaryForeground: '#f8fafc',
    muted: '#1e293b',
    mutedForeground: '#94a3b8',
    accent: '#1e293b',
    accentForeground: '#f8fafc',
    destructive: '#7f1d1d',
    destructiveForeground: '#f8fafc',
    border: '#1e293b',
    input: '#1e293b',
  },

  // Border radius (in px). Sync from the sibling web artifact's --radius
  // CSS variable. This value applies to cards, buttons, inputs, and modals.
  radius: 6,
};

export default colors;
