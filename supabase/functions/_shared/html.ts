// Escaping for text placed into email HTML. Everything that came from a person (titles, notes,
// names, links) goes through these before it is put into a message.

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

// Multi-line text as HTML: escaped, with line breaks kept.
export function multiline(value: string): string {
  return escapeHtml(value).replace(/\r?\n/g, '<br>');
}

// Only http(s) links are ever put into an href.
export function safeHref(url: string): string | null {
  return /^https?:\/\/\S+$/i.test(url) ? escapeHtml(url) : null;
}
