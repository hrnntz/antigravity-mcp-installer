/**
 * Query Google OSV API for vulnerabilities of an npm package
 * @param {string} packageName
 * @param {string|null} currentVersion
 * @returns {Promise<{vulns: any[], activeVulns: string[]}>}
 */
export async function queryOsvVulnerabilities(packageName, currentVersion = null) {
  if (!packageName || typeof packageName !== 'string') {
    return { vulns: [], activeVulns: [] };
  }

  try {
    const res = await fetch('https://api.osv.dev/v1/query', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'antigravity-mcp-installer'
      },
      body: JSON.stringify({
        package: {
          name: packageName,
          ecosystem: 'npm'
        }
      })
    });

    if (!res.ok) return { vulns: [], activeVulns: [] };

    const data = await res.json();
    const vulns = Array.isArray(data.vulns) ? data.vulns : [];
    const activeVulns = [];

    for (const vuln of vulns) {
      const vulnId = vuln.aliases?.[0] || vuln.id;
      const severity = vuln.database_specific?.severity || 'MODERATE';
      let affected = true;

      if (currentVersion) {
        for (const aff of vuln.affected || []) {
          for (const r of aff.ranges || []) {
            if (r.type === 'SEMVER' && Array.isArray(r.events)) {
              const fixedEv = r.events.find(e => e.fixed);
              if (fixedEv && currentVersion >= fixedEv.fixed) {
                affected = false;
              }
            }
          }
        }
      }

      if (affected) {
        activeVulns.push(`${vulnId} (${severity}) - ${vuln.summary || 'Security advisory'}`);
      }
    }

    return { vulns, activeVulns };
  } catch {
    return { vulns: [], activeVulns: [] };
  }
}
