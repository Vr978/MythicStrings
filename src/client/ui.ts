export const escape = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const label = (value: string): string => value.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
export const $ = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T => {
  const node = root.querySelector<T>(selector);
  if (!node) throw new Error('Missing interface element: ' + selector);
  return node;
};
export const text = (element: Element, value: string): void => { if (element.textContent !== value) element.textContent = value; };
export const ornament = '<span class="ornament" aria-hidden="true">✦</span>';
export const logo = '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 3 29 15 42 13 35 24 42 35 29 33 24 45 19 33 6 35 13 24 6 13 19 15Z" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="24" cy="24" r="7" fill="none" stroke="currentColor"/><circle cx="24" cy="24" r="2" fill="currentColor"/></svg>';

export function toast(message: string): void {
  const host = $('#toasts');
  const item = document.createElement('div');
  item.className = 'toast';
  item.setAttribute('role', 'status');
  item.textContent = message;
  host.append(item);
  setTimeout(() => item.remove(), 5000);
}

export async function busy(button: HTMLButtonElement, job: () => Promise<void>, message = 'Working…'): Promise<void> {
  if (button.disabled) return;
  const old = button.innerHTML;
  button.disabled = true;
  button.textContent = message;
  try { await job(); } catch (error) { toast(error instanceof Error ? error.message : 'Something went wrong. Try again.'); }
  finally { button.disabled = false; button.innerHTML = old; }
}
