#!/usr/bin/env node

/**
 * Compare mapping statistics between two runs to ensure no regressions.
 *
 * Usage:
 *   npm run compare:metrics -- <baselineDir> <candidateDir>
 */

const fs = require('fs');
const path = require('path');

function usage(message) {
  if (message) {
    console.error(`\n❌ ${message}`);
  }
  console.error('\nUsage: npm run compare:metrics -- <baselineDir> <candidateDir>');
  console.error('Example: npm run compare:metrics -- storage/datasets/baseline:test\\ 7 storage/datasets/test\\ 10\n');
}

function resolveRunPath(input) {
  if (!input) {
    usage('Missing path argument.');
    process.exit(1);
  }
  const resolved = path.resolve(process.cwd(), input);
  if (!fs.existsSync(resolved)) {
    usage(`Path does not exist: ${resolved}`);
    process.exit(1);
  }
  return resolved;
}

function findMappingDirectory(runPath) {
  const candidates = [
    path.join(runPath, 'datasets', 'mapping'),
    path.join(runPath, 'mapping'),
    path.join(runPath, 'datasets', 'courses', 'mapping'), // fallback for older runs
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
  }
  return null;
}

function aggregateStatistics(runPath) {
  const mappingDir = findMappingDirectory(runPath);

  if (!mappingDir) {
    usage(`Could not find mapping dataset inside ${runPath}`);
    process.exit(1);
  }

  const files = fs.readdirSync(mappingDir);
  const counts = {};
  let summaryFiles = 0;

  for (const fileName of files) {
    if (!fileName.endsWith('.json')) continue;
    const filePath = path.join(mappingDir, fileName);
    let data;
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      data = JSON.parse(raw);
    } catch (err) {
      console.warn(`[compare:metrics] Skipping unreadable file ${filePath}: ${err.message}`);
      continue;
    }
    if (data?.type !== 'mapping_summary' || !data.statistics) {
      continue;
    }
    summaryFiles += 1;
    Object.entries(data.statistics).forEach(([key, value]) => {
      if (typeof value === 'number') {
        counts[key] = (counts[key] || 0) + value;
      }
    });
  }

  if (summaryFiles === 0) {
    usage(`No mapping_summary records found in ${mappingDir}`);
    process.exit(1);
  }

  return { counts, mappingDir, summaryFiles };
}

function formatDiffRow(category, baseline, candidate) {
  const delta = candidate - baseline;
  const drop = baseline > 0 ? ((baseline - candidate) / baseline) * 100 : (candidate < baseline ? 100 : 0);
  return {
    category,
    baseline,
    candidate,
    delta,
    dropPercent: Number.isFinite(drop) ? drop.toFixed(2) : '0.00',
  };
}

function main() {
  const [, , baselineArg, candidateArg] = process.argv;

  if (!baselineArg || !candidateArg) {
    usage('Both baseline and candidate paths are required.');
    process.exit(1);
  }

  const baselinePath = resolveRunPath(baselineArg);
  const candidatePath = resolveRunPath(candidateArg);

  const baseline = aggregateStatistics(baselinePath);
  const candidate = aggregateStatistics(candidatePath);

  const categories = new Set([
    ...Object.keys(baseline.counts),
    ...Object.keys(candidate.counts),
  ]);

  const diffRows = [];
  let hasRegression = false;
  const FILE_DROP_THRESHOLD_PERCENT = 5;

  categories.forEach((category) => {
    const baselineValue = baseline.counts[category] || 0;
    const candidateValue = candidate.counts[category] || 0;
    const row = formatDiffRow(category, baselineValue, candidateValue);

    if (category === 'files') {
      const dropPercent = parseFloat(row.dropPercent);
      if (baselineValue > 0 && dropPercent > FILE_DROP_THRESHOLD_PERCENT) {
        hasRegression = true;
        row.regression = `Files decreased by ${row.dropPercent}% (allowed <= ${FILE_DROP_THRESHOLD_PERCENT}%)`;
      }
    } else if (category !== 'totalUrls' && candidateValue < baselineValue) {
      hasRegression = true;
      row.regression = 'Regression: candidate lower than baseline';
    }

    diffRows.push(row);
  });

  console.log('\n📊 Mapping statistics comparison');
  console.log(`   Baseline:  ${baselinePath}`);
  console.log(`   Candidate: ${candidatePath}`);
  console.log(`   Baseline summaries read:  ${baseline.summaryFiles}`);
  console.log(`   Candidate summaries read: ${candidate.summaryFiles}\n`);
  console.table(diffRows);

  if (hasRegression) {
    console.error('\n❌ Regression detected. See rows flagged above.');
    process.exit(1);
  }

  console.log('\n✅ No regressions detected between runs.');
}

main();

