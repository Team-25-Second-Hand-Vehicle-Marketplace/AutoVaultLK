import { FileValidationError } from './file-validation-error';

type Expect = 'value-or-end' | 'value' | 'comma-or-end';

const isWhitespace = (c: string): boolean =>
  c === ' ' || c === '\n' || c === '\r' || c === '\t';

export async function* iterateJsonArray(
  source: AsyncIterable<Buffer | string>,
): AsyncGenerator<unknown> {
  const decoder = new TextDecoder('utf-8', { fatal: true });

  let started = false;
  let finished = false;
  let expect: Expect = 'value-or-end';

  // The element currently being collected.
  let active = false;
  let inString = false;
  let escaped = false;
  let depth = 0;
  let isPrimitive = false;
  let parts: string[] = [];
  let index = 0;

  const complete = (): unknown => {
    const text = parts.join('');
    parts = [];
    active = false;
    isPrimitive = false;
    expect = 'comma-or-end';
    index++;
    try {
      return JSON.parse(text);
    } catch {
      throw new FileValidationError(`Record ${index} is not valid JSON.`);
    }
  };

  const decode = (chunk: Buffer | string, last: boolean): string => {
    if (typeof chunk === 'string') return chunk;
    try {
      return decoder.decode(chunk, { stream: !last });
    } catch {
      throw new FileValidationError(
        'File is not valid UTF-8. JSON files must be saved as UTF-8.',
      );
    }
  };

  const scan = function* (text: string): Generator<unknown> {
    for (let i = 0; i < text.length; i++) {
      const c = text[i];

      if (finished) {
        if (!isWhitespace(c)) {
          throw new FileValidationError(
            'Unexpected content after the closing ] of the array.',
          );
        }
        continue;
      }

      if (!started) {
        if (c === '﻿' || isWhitespace(c)) continue;
        if (c === '[') {
          started = true;
          continue;
        }
        throw new FileValidationError(
          'JSON file must be an array of vehicle objects, starting with [.',
        );
      }

      if (active) {
        if (inString) {
          parts.push(c);
          if (escaped) escaped = false;
          else if (c === '\\') escaped = true;
          else if (c === '"') {
            inString = false;
            // A bare string element ends at its closing quote.
            if (depth === 0) yield complete();
          }
          continue;
        }

        if (c === '"') {
          inString = true;
          parts.push(c);
          continue;
        }

        if (c === '{' || c === '[') {
          depth++;
          parts.push(c);
          continue;
        }

        if (c === '}' || c === ']') {
          if (depth === 0) {
            // A bare primitive (number, true, null) ended by the array's own
            // closing bracket. Only ] can do that; a stray } is malformed.
            if (c === '}') {
              throw new FileValidationError(
                `Unexpected } after record ${index + 1}.`,
              );
            }
            yield complete();
            finished = true;
            continue;
          }
          depth--;
          parts.push(c);
          if (depth === 0) yield complete();
          continue;
        }

        if (depth === 0 && isPrimitive && (c === ',' || isWhitespace(c))) {
          yield complete();
          if (c === ',') expect = 'value';
          continue;
        }

        parts.push(c);
        continue;
      }

      if (isWhitespace(c)) continue;

      if (c === ']') {
        if (expect === 'value') {
          throw new FileValidationError(
            `Trailing comma before the closing ] (after record ${index}).`,
          );
        }
        finished = true;
        continue;
      }

      if (c === ',') {
        if (expect !== 'comma-or-end') {
          throw new FileValidationError(
            `Unexpected comma${index === 0 ? ' at the start of the array' : ` after record ${index}`}.`,
          );
        }
        expect = 'value';
        continue;
      }

      if (expect === 'comma-or-end') {
        throw new FileValidationError(
          `Expected a comma between record ${index} and the next one.`,
        );
      }

      active = true;
      parts = [c];
      depth = c === '{' || c === '[' ? 1 : 0;
      inString = c === '"';
      isPrimitive = !inString && depth === 0;
    }
  };

  for await (const chunk of source) {
    yield* scan(decode(chunk, false));
  }

  // Flush any partial multi-byte sequence the decoder was holding back.
  yield* scan(decode(Buffer.alloc(0), true));

  if (!started) {
    throw new FileValidationError('File is empty.');
  }

  // A trailing bare primitive with no closing bracket falls through to here.
  if (!finished) {
    throw new FileValidationError(
      'JSON file is incomplete: the array is never closed with ].',
    );
  }
}
