// splatsite/cli/lib/cli-util.mjs — CLI utilities for argument parsing and error handling.
// Exports: parseArgs(argv) -> { _: [...positionals], flag: value|true }, fail(msg, code = 2) -> Error

/**
 * Parse command-line arguments into an object with positionals in `_` and flags as properties.
 * Rule: a `--name` consumes the next argument as its value when that argument exists and does
 * not start with `--`; otherwise the flag is `true`. Positionals (non-flag arguments) are
 * collected in the `_` array.
 * @param {string[]} argv - argument array
 * @returns {Object} { _: [...positionals], flag: value|true }
 */
export function parseArgs(argv) {
  const result = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
        result[key] = argv[++i];
      } else {
        result[key] = true;
      }
    } else {
      result._.push(arg);
    }
  }
  return result;
}

/**
 * Create an error with exit code 2 (for user errors).
 * @param {string} msg - error message
 * @param {number} code - exit code (default 2)
 * @returns {Error} error with `.code` property set
 */
export function fail(msg, code = 2) {
  const e = new Error(msg);
  e.code = code;
  return e;
}
