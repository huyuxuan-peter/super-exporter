import type { Role } from './model';
type Item = { id: string; role: Role };
export type Action = 'all' | 'questions' | 'answers' | 'none' | 'invert';
export function selectGroup(items: readonly Item[], current: ReadonlySet<string>, action: Action): Set<string> {
  return new Set(items.filter(item => action === 'all' || action === 'questions' && item.role === 'user' ||
    action === 'answers' && item.role === 'assistant' || action === 'invert' && !current.has(item.id)).map(item => item.id));
}
export function selectRange(items: readonly Item[], current: ReadonlySet<string>, index: number, anchor: string | undefined, checked: boolean) {
  const selected = new Set(current);
  const start = items.findIndex(item => item.id === anchor);
  const begin = start < 0 ? index : Math.min(start, index);
  const end = start < 0 ? index : Math.max(start, index);
  for (const item of items.slice(begin, end + 1)) {
    if (checked) selected.add(item.id);
    else selected.delete(item.id);
  }
  return selected;
}
