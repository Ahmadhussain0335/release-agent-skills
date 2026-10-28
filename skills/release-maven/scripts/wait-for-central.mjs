#!/usr/bin/env node
// Phase 8: polls repo1.maven.org with backoff until the POM is visible.
// Each run is bounded (default 9 minutes) so it fits agent command timeouts; rerun to keep waiting.
import { runCli, check, result, required, progress } from '../../release-agent-shared/scripts/lib/cli.mjs';
import { fetchWithRetry, sleep, backoffDelay } from '../../release-agent-shared/scripts/lib/http.mjs';
import { pomUrl, CENTRAL_REPO } from './lib/maven.mjs';

export async function waitForCentral({ group, artifact, version, timeoutMin = 9, initialSec = 30, maxIntervalSec = 300, base = CENTRAL_REPO, fetchImpl = fetch, sleepImpl = sleep, now = Date.now }) {
  const url = pomUrl(group, artifact, version, base);
  const started = now();
  for (let attempt = 0; ; attempt++) {
    let status = null;
    try {
      status = (await fetchWithRetry(url, { method: 'HEAD' }, { fetchImpl, retries: 1 })).status;
    } catch (err) {
      progress(`[wait-for-central] request failed (${err.message}); will retry`);
    }
    const elapsedMin = Math.round((now() - started) / 60000);
    if (status === 200) {
      return result([check('central.visible', 'pass', `${group}:${artifact}:${version} is visible on repo1.maven.org after ${attempt + 1} check(s)`)], { url, visible: true });
    }
    const delay = backoffDelay(attempt, initialSec * 1000, maxIntervalSec * 1000);
    if (now() - started + delay > timeoutMin * 60000) {
      return result([check('central.visible', 'fail', `Not visible yet after ${elapsedMin} min in this run. Sync usually takes 10 to 30 minutes and can take longer; this is normal. Run again to keep waiting (errors.md E22).`)], { url, visible: false, lastStatus: status });
    }
    progress(`[wait-for-central] not visible yet (HTTP ${status ?? 'error'}, ${elapsedMin} min elapsed); next check in ${Math.round(delay / 1000)}s`);
    await sleepImpl(delay);
  }
}

await runCli(import.meta.url, {
  usage: 'Usage: wait-for-central.mjs --group <g> --artifact <a> --version <v> [--timeout-min 9] [--initial-sec 30]',
  options: { group: { type: 'string' }, artifact: { type: 'string' }, version: { type: 'string' }, 'timeout-min': { type: 'string', default: '9' }, 'initial-sec': { type: 'string', default: '30' } },
}, (v) => {
  required(v, 'group', 'artifact', 'version');
  return waitForCentral({ group: v.group, artifact: v.artifact, version: v.version, timeoutMin: Number(v['timeout-min']), initialSec: Number(v['initial-sec']) });
});
