/**
 * Manual parser inspector — a dev tool, not part of the running service.
 *
 * The unit tests prove specific inputs produce specific outputs. This exists
 * for the other half of the job: seeing what the parser does to a query
 * nobody thought to write a test for yet. Every interesting result found here
 * should end up back in a .spec.ts as a real assertion.
 *
 *   npm run inspect:tokens -- "toyota land cruiser under 5m"
 *
 * With no argument it runs a built-in sample set covering each rule.
 *
 * Uses a fixture dictionary rather than the database, so it runs with no
 * connection and no seed. The fixture mirrors the real seed's shape,
 * including the multi-word aliases that motivated Stage 1.
 */

import { tokenize } from './tokenizer';
import { extractPhrases } from './phrase-extractor';
import { Token, ParsedFilters } from './parser.types';
import { isDomainOperator } from './stopwords.constants';
import { buildCache } from '../repositories/vehicle-dictionary.repository';

const FIXTURE_ROWS = [
  { id: 'mk-toyota', parent_id: null, dictionary_type: 'MAKE', canonical_value: 'Toyota', vehicle_types: ['CAR', 'SUV', 'VAN'], aliases: ['toyata', 'toyta'] },
  { id: 'mk-honda', parent_id: null, dictionary_type: 'MAKE', canonical_value: 'Honda', vehicle_types: ['CAR', 'SUV'], aliases: [] },
  { id: 'mk-nissan', parent_id: null, dictionary_type: 'MAKE', canonical_value: 'Nissan', vehicle_types: ['CAR'], aliases: [] },
  { id: 'mk-ashok', parent_id: null, dictionary_type: 'MAKE', canonical_value: 'Ashok Leyland', vehicle_types: ['LORRY'], aliases: ['ashok leylend'] },
  { id: 'mk-lr', parent_id: null, dictionary_type: 'MAKE', canonical_value: 'Land Rover', vehicle_types: ['SUV'], aliases: [] },
  { id: 'md-lc', parent_id: 'mk-toyota', dictionary_type: 'MODEL', canonical_value: 'Land Cruiser', vehicle_types: ['SUV'], aliases: ['landcruiser', 'land cruser'] },
  { id: 'md-prado', parent_id: 'mk-toyota', dictionary_type: 'MODEL', canonical_value: 'Prado', vehicle_types: ['SUV'], aliases: [] },
  { id: 'md-aqua', parent_id: 'mk-toyota', dictionary_type: 'MODEL', canonical_value: 'Aqua', vehicle_types: ['CAR'], aliases: [] },
  { id: 'md-rav4', parent_id: 'mk-toyota', dictionary_type: 'MODEL', canonical_value: 'RAV4', vehicle_types: ['SUV'], aliases: ['rav 4'] },
  { id: 'md-townace', parent_id: 'mk-toyota', dictionary_type: 'MODEL', canonical_value: 'Townace', vehicle_types: ['VAN'], aliases: ['town ace'] },
  { id: 'md-vezel', parent_id: 'mk-honda', dictionary_type: 'MODEL', canonical_value: 'Vezel', vehicle_types: ['SUV'], aliases: [] },
  { id: 'md-leaf', parent_id: 'mk-nissan', dictionary_type: 'MODEL', canonical_value: 'Leaf', vehicle_types: ['CAR'], aliases: [] },
  { id: 'md-rre', parent_id: 'mk-lr', dictionary_type: 'MODEL', canonical_value: 'Range Rover Evoque', vehicle_types: ['SUV'], aliases: [] },
];

const SAMPLES = [
  'Toyota Aqua under 5 million automatic',
  'I want a hybrid car under Rs. 8,500,000',
  'honda vezel 2015-2018 low mileage',
  'toyota land cruiser prado',
  'land cruser for sale',
  'range rover evoque',
  'brand new three wheeler',
  'four wheel drive station wagon',
  'ashok leylend lorry',
  'rav 4 or town ace',
  'family car good for long drives',
  'land the cruiser',
];

const dict = buildCache(FIXTURE_ROWS);

const useColour = process.stdout.isTTY === true;
const paint = (code: string, text: string) =>
  useColour ? `\x1b[${code}m${text}\x1b[0m` : text;

const dim = (t: string) => paint('90', t);
const green = (t: string) => paint('32', t);
const yellow = (t: string) => paint('33', t);
const cyan = (t: string) => paint('36', t);
const magenta = (t: string) => paint('35', t);

/**
 * Renders one token as a labelled cell. The states worth telling apart by eye
 * are exactly the ones that decide a token's fate.
 */
function renderToken(token: Token): string {
  if (token.role === 'phrase') {
    return magenta(`${token.text}·phrase`);
  }
  if (token.role === 'stopword') {
    return dim(`${token.text}·masked`);
  }
  if (isDomainOperator(token.text)) {
    return yellow(`${token.text}·op`);
  }
  return green(token.text);
}

/** Compact one-line rendering of whatever the stages have resolved so far. */
function renderFilters(filters: ParsedFilters): string {
  const parts: string[] = [];

  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined) continue;
    if (key === 'specs' && Array.isArray(value)) {
      const specs = value as Array<{ key: string; value: string }>;
      parts.push(...specs.map((s) => `${s.key}=${s.value}`));
    } else if (Array.isArray(value)) {
      parts.push(`${key}=[${value.join(', ')}]`);
    } else {
      parts.push(`${key}=${String(value)}`);
    }
  }

  return parts.length > 0 ? parts.join('  ') : dim('(none)');
}

function inspect(query: string): void {
  const tokens = tokenize(query);
  const filters: ParsedFilters = {};
  extractPhrases(tokens, dict, filters);

  console.log(cyan(`\n  "${query}"`));

  if (tokens.length === 0) {
    console.log(dim('    (no tokens)'));
    return;
  }

  console.log('    ' + tokens.map(renderToken).join(dim(' │ ')));
  console.log('    ' + dim('filters: ') + renderFilters(filters));

  const unconsumed = tokens.filter((t) => t.role === 'unconsumed' && !isDomainOperator(t.text));
  console.log(
    dim(
      `    ${tokens.length} tokens · ${unconsumed.length} still unclaimed ` +
        `(would reach semanticText today)`,
    ),
  );
}

function main(): void {
  const query = process.argv.slice(2).join(' ').trim();

  if (query.length > 0) {
    inspect(query);
  } else {
    console.log(dim('\nNo query given — running the built-in sample set.'));
    console.log(
      dim('Legend: ') +
        green('unclaimed') +
        dim(' │ ') +
        magenta('phrase (stage 1)') +
        dim(' │ ') +
        yellow('operator (stage 2 reads it)') +
        dim(' │ ') +
        dim('masked'),
    );
    SAMPLES.forEach(inspect);
  }

  console.log('');
}

main();
