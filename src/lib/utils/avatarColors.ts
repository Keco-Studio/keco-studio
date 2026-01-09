/**
 * Avatar Color Utility
 * 
 * Generates consistent, deterministic HSL colors for user avatars
 * based on user ID. Each user always gets the same color across sessions.
 * 
 * Color palette: 12 distinct hues (30° intervals) with fixed saturation
 * and lightness for accessibility and visual consistency.
 */

/**
 * Hash a string to a consistent integer
 * Uses simple hash algorithm for deterministic results
 */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

/**
 * Generate a consistent HSL color for a user based on their ID
 * 
 * @param userId - The unique user identifier
 * @returns HSL color string (e.g., "hsl(180, 70%, 60%)")
 * 
 * @example
 * getUserAvatarColor('user-123') // Returns "hsl(180, 70%, 60%)"
 * getUserAvatarColor('user-123') // Always returns the same color
 */
export function getUserAvatarColor(userId: string): string {
  const hash = hashString(userId);
  
  // Map hash to one of 12 hues (0, 30, 60, ..., 330 degrees)
  const hue = (hash % 12) * 30;
  
  // Fixed saturation and lightness for consistent appearance
  // 70% saturation: vibrant but not overly intense
  // 60% lightness: good contrast on both light and dark backgrounds
  const saturation = 70;
  const lightness = 60;
  
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

/**
 * Get CSS border style for a user's avatar color
 * 
 * @param userId - The unique user identifier
 * @param width - Border width in pixels (default: 2)
 * @returns CSS border string
 * 
 * @example
 * getUserAvatarBorder('user-123') // Returns "2px solid hsl(180, 70%, 60%)"
 */
export function getUserAvatarBorder(userId: string, width: number = 2): string {
  const color = getUserAvatarColor(userId);
  return `${width}px solid ${color}`;
}

/**
 * Color palette reference (for documentation/testing)
 * Each hue corresponds to a different color family
 */
export const COLOR_PALETTE = [
  { hue: 0, name: 'Red' },
  { hue: 30, name: 'Orange' },
  { hue: 60, name: 'Yellow' },
  { hue: 90, name: 'Yellow-Green' },
  { hue: 120, name: 'Green' },
  { hue: 150, name: 'Cyan-Green' },
  { hue: 180, name: 'Cyan' },
  { hue: 210, name: 'Blue-Cyan' },
  { hue: 240, name: 'Blue' },
  { hue: 270, name: 'Purple' },
  { hue: 300, name: 'Magenta' },
  { hue: 330, name: 'Pink' },
] as const;

/**
 * Get all possible avatar colors (useful for UI previews)
 * 
 * @returns Array of HSL color strings
 */
export function getAllAvatarColors(): string[] {
  return COLOR_PALETTE.map(({ hue }) => `hsl(${hue}, 70%, 60%)`);
}

/**
 * Check if two user IDs would have similar colors
 * (Within 60 degrees of hue, which is 2 palette steps)
 * 
 * @param userId1 - First user ID
 * @param userId2 - Second user ID
 * @returns True if colors are similar
 */
export function haveSimilarColors(userId1: string, userId2: string): boolean {
  const hash1 = hashString(userId1);
  const hash2 = hashString(userId2);
  
  const hue1 = (hash1 % 12) * 30;
  const hue2 = (hash2 % 12) * 30;
  
  // Calculate angular distance (accounting for wrap-around at 360)
  const distance = Math.min(
    Math.abs(hue1 - hue2),
    360 - Math.abs(hue1 - hue2)
  );
  
  return distance <= 60;
}

/**
 * Get color name for a user (useful for accessibility labels)
 * 
 * @param userId - The unique user identifier
 * @returns Human-readable color name
 * 
 * @example
 * getUserColorName('user-123') // Returns "Cyan"
 */
export function getUserColorName(userId: string): string {
  const hash = hashString(userId);
  const index = hash % 12;
  return COLOR_PALETTE[index].name;
}

