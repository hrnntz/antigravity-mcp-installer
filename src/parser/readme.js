/**
 * Automatically detect required environment variables or API keys from README markdown
 * @param {string} readmeText
 * @returns {string[]}
 */
export function detectRequiredEnvVars(readmeText) {
  if (!readmeText || typeof readmeText !== 'string') return [];
  const found = new Set();

  // Match typical uppercase env var patterns (e.g. BRAVE_API_KEY, GITHUB_TOKEN, POSTGRES_URL)
  const matches = readmeText.match(/\b([A-Z0-9_]{2,}_(?:KEY|TOKEN|SECRET|URL|API|PASSWORD|PAT|ID|AUTH))\b/g);
  if (matches) {
    const ignored = new Set([
      'API_KEY',
      'SECRET_KEY',
      'YOUR_API_KEY',
      'YOUR_TOKEN',
      'ACCESS_TOKEN',
      'BEARER_TOKEN',
      'MY_API_KEY',
      'EXAMPLE_API_KEY'
    ]);
    matches.forEach(m => {
      if (!ignored.has(m) && m.length < 40) {
        found.add(m);
      }
    });
  }

  // Match JSON env block in README (e.g. "env": { "FOO": ... })
  const envBlockRegex = /"env"\s*:\s*\{([^}]+)\}/gi;
  let match;
  while ((match = envBlockRegex.exec(readmeText)) !== null) {
    const keys = match[1].match(/"([A-Z0-9_]+)"\s*:/g);
    if (keys) {
      keys.forEach(k => found.add(k.replace(/[" :]/g, '')));
    }
  }

  return Array.from(found).slice(0, 8);
}

/**
 * Parse and extract key capabilities bullet points from package README
 * @param {string} readmeText
 * @returns {string[]}
 */
export function extractCapabilities(readmeText) {
  if (!readmeText || typeof readmeText !== 'string') return [];
  const lines = readmeText.split('\n');
  let capturing = false;
  const capabilities = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^#{1,3}\s+.*?(features|tools|capabilities|operations|overview|about)/i.test(trimmed)) {
      capturing = true;
      continue;
    }
    if (capturing) {
      if (/^#{1,2}\s+/.test(trimmed)) {
        break;
      }
      if (trimmed.startsWith('-') || trimmed.startsWith('*')) {
        const clean = trimmed
          .replace(/^[-*]\s*/, '')
          .replace(/\*\*/g, '')
          .replace(/`([^`]+)`/g, '$1')
          .trim();
        if (clean && clean.length > 5 && capabilities.length < 5) {
          capabilities.push(clean);
        }
      }
    }
  }
  return capabilities;
}
