import ora from 'ora';
import pc from 'picocolors';
import { VALID_NPM_PACKAGE_NAME } from '../constants.js';

/**
 * Quick heuristic risk evaluation for search results listing
 * @param {object} pkg
 * @returns {{level: 'LOW'|'MEDIUM'|'HIGH', label: string}}
 */
export function evaluateQuickRisk(pkg) {
  const weekly = pkg.downloadsWeekly || 0;
  const hasRepo = Boolean(pkg.hasRepo);
  const isOfficial = pkg.name.startsWith('@modelcontextprotocol/');

  if (isOfficial) {
    return { level: 'LOW', label: pc.green('🟢 Low Risk') };
  }

  if (weekly < 25 && !hasRepo) {
    return { level: 'HIGH', label: pc.red('🔴 High Risk') };
  }

  if (weekly < 100 || !hasRepo) {
    return { level: 'MEDIUM', label: pc.yellow('🟡 Medium Risk') };
  }

  return { level: 'LOW', label: pc.green('🟢 Low Risk') };
}

/**
 * Compute relevance and popularity rank for a package candidate
 * @param {object} item
 * @param {string} lowerTerm
 * @returns {number}
 */
export function computeRank(item, lowerTerm) {
  const pkg = item.package;
  const name = (pkg.name || '').toLowerCase();
  const desc = (pkg.description || '').toLowerCase();
  const keywords = (pkg.keywords || []).map(k => String(k).toLowerCase());
  const weekly = item.downloads?.weekly || 0;

  let score = 0;

  if (name.includes(lowerTerm) && name.includes('mcp')) {
    score += 10000000;
  } else if (name.includes(lowerTerm)) {
    score += 5000000;
  } else if (keywords.some(k => k.includes(lowerTerm))) {
    score += 2000000;
  } else if (desc.includes(lowerTerm)) {
    score += 1000000;
  }

  score += weekly;
  return score;
}

/**
 * Search MCP servers via npm registry API and rank by Term Relevance + Download Popularity
 * @param {string} searchTerm
 * @returns {Promise<any[]>}
 */
export async function searchNpmMcpServers(searchTerm) {
  const sanitizedTerm = searchTerm.trim().replace(/[\r\n\0]/g, '');
  if (!sanitizedTerm) return [];

  const lowerTerm = sanitizedTerm.toLowerCase();

  const spinner = ora({
    text: `Searching npm registry for "${sanitizedTerm}" MCP servers...`,
    color: 'cyan'
  }).start();

  try {
    let query = `${sanitizedTerm} mcp-server`;
    let url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=50`;

    let response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'antigravity-mcp-installer'
      }
    });

    if (!response.ok) {
      throw new Error(`npm registry returned HTTP ${response.status}`);
    }

    let data = await response.json();

    if (!data.objects || data.objects.length === 0) {
      spinner.text = 'Broadening search...';
      query = `${sanitizedTerm} mcp`;
      url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=50`;
      response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'antigravity-mcp-installer'
        }
      });
      if (response.ok) {
        data = await response.json();
      }
    }

    spinner.succeed('Search completed.');

    if (!Array.isArray(data.objects) || data.objects.length === 0) {
      return [];
    }

    const candidates = data.objects.filter(item => {
      const pkg = item.package;
      if (!pkg?.name || !VALID_NPM_PACKAGE_NAME.test(pkg.name)) return false;

      const name = (pkg.name || '').toLowerCase();
      const desc = (pkg.description || '').toLowerCase();
      const keywords = (pkg.keywords || []).map(k => String(k).toLowerCase());

      const matchesTerm = name.includes(lowerTerm) || keywords.some(k => k.includes(lowerTerm)) || desc.includes(lowerTerm);
      const isMcp = name.includes('mcp') || keywords.some(k => k.includes('mcp')) || desc.includes('mcp') || desc.includes('model context protocol');

      return matchesTerm && isMcp;
    });

    const pool = candidates.length > 0 ? candidates : data.objects.filter(item => {
      const pkg = item.package;
      if (!pkg?.name || !VALID_NPM_PACKAGE_NAME.test(pkg.name)) return false;
      const name = (pkg.name || '').toLowerCase();
      const desc = (pkg.description || '').toLowerCase();
      const keywords = (pkg.keywords || []).map(k => String(k).toLowerCase());
      return name.includes('mcp') || keywords.some(k => k.includes('mcp')) || desc.includes('mcp');
    });

    const sortedResults = pool
      .map(item => ({
        name: item.package.name,
        version: item.package.version || '0.0.0',
        description: item.package.description || 'No description available',
        downloadsWeekly: item.downloads?.weekly || 0,
        downloadsMonthly: item.downloads?.monthly || 0,
        hasRepo: Boolean(item.package.links?.repository),
        repoUrl: item.package.links?.repository || '',
        _rank: computeRank(item, lowerTerm)
      }))
      .sort((a, b) => b._rank - a._rank);

    return sortedResults;
  } catch (error) {
    spinner.fail(pc.red('Failed to reach npm registry.'));
    throw error;
  }
}
