/**
 * Raised when a file cannot be processed at all. The orchestrator turns this
 * into a FAILED job with the message shown to the dealer.
 *
 * This is the deliberate exception to "a stage never throws because of
 * content". The rule exists so one bad row cannot fail a job - but a file with
 * no header row has no rows to reject, and reporting 5,000 identical per-row
 * rejections would be worse than one clear sentence. validateFile is the ONLY
 * stage permitted to fail a job on content; every stage after it works on rows
 * that are known to be parseable.
 *
 * Lives in its own module, not in validate-file.stage, because the format
 * readers throw it too and the stage imports the readers.
 */
export class FileValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileValidationError';
  }
}
