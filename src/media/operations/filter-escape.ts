/**
 * A value inside a filtergraph is unescaped twice: once as a filter option
 * (`\`, `'` and `:` are special) and once as part of the graph (`\`, `'`,
 * `[`, `]`, `,` and `;`). Escaping for both, in that order, lets anything
 * through as itself — measured on the core with all of them in one caption.
 */
export function escapeFilterValue(value: string): string {
  const option = value.replace(/[\\':]/g, '\\$&');
  return option.replace(/[\\'[\],;]/g, '\\$&');
}
