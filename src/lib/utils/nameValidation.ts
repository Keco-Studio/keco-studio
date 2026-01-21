/**
 * Validates if a name contains disallowed characters
 * @param name The name to validate
 * @returns Returns null if the name is valid, otherwise returns an error message
 */
export function validateName(name: string): string | null {
  if (!name || name.trim().length === 0) {
    return null; // Empty names are handled by other validation
  }

  // Detect emojis (including various emoji ranges)
  // Check common emoji Unicode ranges
  const emojiRanges = [
    /[\u2600-\u26FF]/, // Miscellaneous Symbols
    /[\u2700-\u27BF]/, // Dingbats
    /[\u{1F300}-\u{1F5FF}]/u, // Miscellaneous Symbols and Pictographs
    /[\u{1F600}-\u{1F64F}]/u, // Emoticons
    /[\u{1F680}-\u{1F6FF}]/u, // Transport and Map Symbols
    /[\u{1F1E0}-\u{1F1FF}]/u, // Flags
    /[\u{1F900}-\u{1F9FF}]/u, // Supplemental Symbols and Pictographs
    /[\u{1FA00}-\u{1FAFF}]/u, // Symbols and Pictographs Extended-A
    /[\u200D]/, // Zero Width Joiner
    /[\uFE00-\uFE0F]/, // Variation Selectors
  ];
  
  for (const regex of emojiRanges) {
    if (regex.test(name)) {
      return 'No emojis, HTML tags or !@#$% allowed';
    }
  }
  
  // Detect emojis using Unicode property classes (if supported)
  // Note: \p{Emoji} includes numbers and other characters, so we use more specific properties
  try {
    // Only check for emoji presentation and modifier base, exclude emoji that are also numbers/letters
    const emojiUnicodeRegex = /\p{Emoji_Presentation}|\p{Emoji_Modifier_Base}/gu;
    if (emojiUnicodeRegex.test(name)) {
      // Double-check: exclude common alphanumeric characters that might be flagged
      // Remove the match if it's just a regular character
      const matches = name.match(emojiUnicodeRegex);
      if (matches) {
        // Filter out false positives (numbers, basic letters)
        const falsePositives = /^[0-9A-Za-z]$/;
        const realEmojis = matches.filter(m => !falsePositives.test(m));
        if (realEmojis.length > 0) {
          return 'No emojis, HTML tags or !@#$% allowed';
        }
      }
    }
  } catch (e) {
    // If Unicode property classes are not supported, ignore this check (already covered by range checks above)
  }

  // Detect HTML tags (check content between < and >)
  const htmlTagRegex = /<[^>]*>/g;
  if (htmlTagRegex.test(name)) {
    return 'No emojis, HTML tags or !@#$% allowed';
  }

  // Detect special characters !@#$%
  const specialCharsRegex = /[!@#$%]/;
  if (specialCharsRegex.test(name)) {
    return 'No emojis, HTML tags or !@#$% allowed';
  }

  return null;
}

