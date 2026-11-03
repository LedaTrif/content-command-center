export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g,
  c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function safeUrl(value) {
  try {
    const url = new URL(String(value));
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

function inline(text) {
  // Escape all HTML. A deliberately small Markdown subset has no executable HTML.
  return text.split(/(\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))/g).map(part => {
    const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
    if (link && safeUrl(link[2])) return `<a href="${escapeHtml(safeUrl(link[2]))}" rel="noopener">${escapeHtml(link[1])}</a>`;
    return escapeHtml(part).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  }).join('');
}

export function articleHtml(markdown, sources = []) {
  const blocks = [], paragraph = [];
  let inList = false;
  const flushParagraph = () => { if (paragraph.length) blocks.push(`<p>${inline(paragraph.splice(0).join(' '))}</p>`); };
  const closeList = () => { if (inList) { blocks.push('</ul>'); inList = false; } };
  for (const line of String(markdown).replace(/\r/g, '').split('\n')) {
    const heading = line.match(/^(#{1,3})\s+(.+)$/), bullet = line.match(/^[-*]\s+(.+)$/);
    if (heading) { flushParagraph(); closeList(); const level = Math.max(2,heading[1].length); blocks.push(`<h${level}>${inline(heading[2])}</h${level}>`); }
    else if (bullet) { flushParagraph(); if (!inList) { blocks.push('<ul>'); inList = true; } blocks.push(`<li>${inline(bullet[1])}</li>`); }
    else if (!line.trim()) { flushParagraph(); closeList(); }
    else { closeList(); paragraph.push(line.trim()); }
  }
  flushParagraph(); closeList();
  const links = sources.filter(s => safeUrl(s.url));
  if (links.length) blocks.push('<h2>Източници</h2><ul>' + links.map(s => `<li><a href="${escapeHtml(safeUrl(s.url))}" rel="noopener">${escapeHtml(s.title || s.url)}</a></li>`).join('') + '</ul>');
  return blocks.join('\n');
}

export function validImageUrl(value) {
  if (!value) return true;
  try {
    const u = new URL(value);
    // No arbitrary server fetches or redirects. Only existing project/WP images.
    return u.protocol === 'https:' && !u.username && !u.password && !u.port &&
      ((u.hostname === 'ledatrif.github.io' && u.pathname.startsWith('/content-command-center/media/')) ||
       (u.hostname === 'www.zabarcelona.com' && u.pathname.startsWith('/wp-content/uploads/'))) &&
      /\.(png|jpe?g|webp)$/i.test(u.pathname);
  } catch { return false; }
}

export function validateDraft(input) {
  const draft = {};
  for (const [key,limit] of Object.entries({title:250,body_markdown:100000,excerpt:1000,slug:160,image_url:2000,image_alt:500})) {
    if (typeof input[key] !== 'string' || input[key].length > limit) throw new Error('Невалидно или прекалено дълго поле: ' + key);
    draft[key] = input[key].trim();
  }
  if (!draft.title || !draft.body_markdown) throw new Error('Добави заглавие и текст.');
  if (draft.slug && !/^[\p{L}\p{N}-]+$/u.test(draft.slug)) throw new Error('Адресът може да съдържа букви, цифри и тирета.');
  if (!validImageUrl(draft.image_url)) throw new Error('Избери JPG, PNG или WebP от снимките на командния център или zabarcelona.com.');
  if (draft.image_url && !draft.image_alt) throw new Error('Добави описание на снимката.');
  if (!Array.isArray(input.sources) || input.sources.length > 30 || input.sources.some(s => !s || !safeUrl(s.url) || typeof s.title !== 'string' || s.title.length > 300)) throw new Error('Провери линковете към източниците.');
  draft.sources = input.sources.map(s => ({title:s.title.trim(),url:safeUrl(s.url)}));
  if (!Array.isArray(input.category_ids) || input.category_ids.length > 10 || input.category_ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error('Невалидна категория.');
  draft.category_ids = [...new Set(input.category_ids)];
  return draft;
}
