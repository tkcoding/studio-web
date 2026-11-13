export function matchesSearch(text: string, ...fields: string[]): boolean {
  const needle = text.trim().toLowerCase();
  return !needle || fields.some((field) => field.toLowerCase().includes(needle));
}
