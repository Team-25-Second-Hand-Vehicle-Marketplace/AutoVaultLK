// Wraps vehicle-generator.ts's own CSV output and rewrites the
// registration_number column with a run-unique prefix, then writes the
// result back out. vehicle-generator's own generateRegistration() returns
// WP-0001, WP-0002... starting from 1 in EVERY invocation (confirmed by
// reading its source), so two separately-generated files always collide on
// marketplace.vehicles' real unique constraint on registration_number -
// this is what k6's dealer-ingestion-volume.js already works around at
// upload time for CSV-only tests; the CSV+ZIP volume test needs the
// uniqueness baked in at generation time instead, since the ZIP's image
// filenames must match the CSV's registration numbers exactly and a
// runtime rewrite (as k6 does for CSV-only) would desync the two.
import { readFile, writeFile } from 'fs/promises';

function parseArguments() {
  const args = process.argv.slice(2);
  let input: string | undefined;
  let output: string | undefined;
  let prefix = `RUN${Date.now()}`;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--input':
        input = args[++i];
        break;
      case '--output':
        output = args[++i];
        break;
      case '--prefix':
        prefix = args[++i];
        break;
    }
  }

  if (!input || !output) {
    throw new Error('--input and --output are both required');
  }
  return { input, output, prefix };
}

async function main() {
  const { input, output, prefix } = parseArguments();
  const content = await readFile(input, 'utf-8');
  const lines = content.trim().split(/\r?\n/);
  const [header, ...rows] = lines;

  const columns = header.split(',');
  const regIndex = columns.indexOf('registration_number');
  if (regIndex === -1) {
    throw new Error(`registration_number column not found in ${input}`);
  }

  const rewritten = rows.map((row, i) => {
    const cells = row.split(',');
    cells[regIndex] = `${prefix}-${i}`;
    return cells.join(',');
  });

  await writeFile(output, [header, ...rewritten].join('\n') + '\n', 'utf-8');
  console.log(`Rewrote ${rewritten.length} registration numbers with prefix ${prefix} -> ${output}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
