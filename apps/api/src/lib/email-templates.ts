/**
 * Branded transactional emails. One layout, inline styles (email clients
 * ignore stylesheets), and a plain-text twin for every message.
 */

export interface EmailBrand {
  brandName: string;
  legalName: string;
  address: string | null;
  email: string | null;
  /** When set, the logo is attached inline with this content id. */
  logoCid?: string;
}

export interface EmailContent {
  preheader: string;
  heading: string;
  paragraphs: string[];
  rows?: [string, string][];
  action?: { label: string; url: string };
  note?: string;
}

const C = {
  paper: '#f6f2ee',
  cotton: '#fcfbf9',
  ink: '#241e1a',
  muted: '#6d645e',
  rule: '#e3dcd5',
  coral: '#c2563f',
};

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

export function renderEmail(
  brand: EmailBrand,
  content: EmailContent,
): { html: string; text: string } {
  const font = "'Instrument Sans', -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
  const mark = brand.logoCid
    ? `<img src="cid:${brand.logoCid}" alt="${esc(brand.brandName)}" height="32" style="display:block;height:32px;width:auto;border:0">`
    : `<span style="font:600 20px/1 ${font};color:${C.ink};letter-spacing:-0.02em">${esc(brand.brandName)}</span><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${C.coral};margin-left:3px;vertical-align:2px"></span>`;
  const rows = content.rows?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;border-top:1px solid ${C.rule}">${content.rows
        .map(
          ([k, v]) =>
            `<tr><td style="padding:8px 0;border-bottom:1px solid ${C.rule};font:14px/1.4 ${font};color:${C.muted}">${esc(k)}</td><td align="right" style="padding:8px 0;border-bottom:1px solid ${C.rule};font:14px/1.4 ${font};color:${C.ink}">${esc(v)}</td></tr>`,
        )
        .join('')}</table>`
    : '';
  const action = content.action
    ? `<p style="margin:24px 0"><a href="${esc(content.action.url)}" style="display:inline-block;padding:12px 20px;background:${C.ink};color:${C.cotton};border-radius:8px;font:500 15px/1 ${font};text-decoration:none">${esc(content.action.label)}</a></p>`
    : '';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(content.heading)}</title></head>
<body style="margin:0;background:${C.paper}">
<span style="display:none;max-height:0;overflow:hidden">${esc(content.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.paper}"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="padding:0 4px 20px">${mark}</td></tr>
<tr><td style="background:${C.cotton};border-radius:8px;padding:32px;box-shadow:0 1px 2px rgba(60,40,30,.08)">
<h1 style="margin:0 0 16px;font:600 22px/1.25 ${font};color:${C.ink};letter-spacing:-0.02em">${esc(content.heading)}</h1>
${content.paragraphs.map((p) => `<p style="margin:0 0 12px;font:15px/1.6 ${font};color:${C.ink}">${esc(p)}</p>`).join('')}
${rows}${action}
${content.note ? `<p style="margin:16px 0 0;font:13px/1.5 ${font};color:${C.muted}">${esc(content.note)}</p>` : ''}
</td></tr>
<tr><td style="padding:20px 4px;font:12px/1.6 ${font};color:${C.muted}">${esc(brand.legalName)}${brand.address ? `<br>${esc(brand.address)}` : ''}${brand.email ? `<br>${esc(brand.email)}` : ''}</td></tr>
</table></td></tr></table></body></html>`;

  const text = [
    content.heading,
    '',
    ...content.paragraphs,
    ...(content.rows?.length ? ['', ...content.rows.map(([k, v]) => `${k}: ${v}`)] : []),
    ...(content.action ? ['', `${content.action.label}: ${content.action.url}`] : []),
    ...(content.note ? ['', content.note] : []),
    '',
    '--',
    brand.legalName,
    ...(brand.address ? [brand.address] : []),
  ].join('\n');

  return { html, text };
}
