const PAGE_TIMEOUT_MS = 7000;
const WEBSITE_CONCURRENCY = 3;
const PAGE_CONCURRENCY = 4;
const MAX_URLS_PER_REQUEST = 15;

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({
        success: false,
        message: 'Method not allowed. Use POST.'
      });
    }

    const rawInput = req.body?.rawInput || '';
    const result = await extractBulkData(rawInput);
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
  }
};

async function extractBulkData(rawInput) {
  const urls = normalizeUrls(rawInput);

  if (!urls.length) {
    return {
      success: false,
      message: 'Please enter at least one URL.'
    };
  }

  if (urls.length > MAX_URLS_PER_REQUEST) {
    return {
      success: false,
      message: `Free version me aik request me max ${MAX_URLS_PER_REQUEST} URLs allow hain.`
    };
  }

  const results = await asyncPool(WEBSITE_CONCURRENCY, urls, processWebsite);

  return {
    success: true,
    total: results.length,
    results
  };
}

function normalizeUrls(rawInput) {
  if (!rawInput) return [];

  const urls = String(rawInput)
    .split(/[\n,;\t\r ]+/)
    .map(v => String(v || '').trim())
    .filter(v => v)
    .map(v => {
      if (!/^https?:\/\//i.test(v)) return 'https://' + v;
      return v;
    });

  const seen = new Set();
  const unique = [];

  for (const url of urls) {
    const key = url.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(url);
    }
  }

  return unique;
}

async function processWebsite(url) {
  try {
    const pages = buildCandidatePages(url);
    const pageResultsRaw = await asyncPool(PAGE_CONCURRENCY, pages, fetchPage);
    const pageResults = pageResultsRaw.filter(item => item.ok);

    if (!pageResults.length) {
      return buildErrorRow(url, 'Unable to fetch website or supported inner pages');
    }

    let mergedHtml = '';
    let mergedText = '';
    let titles = [];
    let allLinks = [];
    let telLinks = [];
    let mailtoEmails = [];

    for (const page of pageResults) {
      mergedHtml += '\n' + page.html;
      mergedText += '\n' + page.text;
      if (page.title) titles.push(page.title);
      allLinks = allLinks.concat(page.links);
      telLinks = telLinks.concat(page.telLinks);
      mailtoEmails = mailtoEmails.concat(page.mailtoEmails);
    }

    mergedHtml = cleanupContent(mergedHtml);
    mergedText = cleanupContent(mergedText);

    const emails = extractEmails(mergedHtml, uniqueArray(mailtoEmails));
    const phones = extractPhones(mergedHtml, mergedText, uniqueArray(telLinks));
    const socials = extractSocialLinks(mergedHtml, uniqueArray(allLinks), url);

    return {
      url,
      status: 'Success',
      title: uniqueArray(titles).join(' | '),
      emails,
      phones,
      facebook: socials.facebook,
      instagram: socials.instagram,
      linkedin: socials.linkedin,
      twitter: socials.twitter,
      youtube: socials.youtube,
      tiktok: socials.tiktok,
      pinterest: socials.pinterest,
      whatsapp: socials.whatsapp,
      telegram: socials.telegram,
      allSocials: socials.allSocials,
      crawledPages: pageResults.map(p => p.url),
      emailCount: emails.length,
      phoneCount: phones.length,
      socialCount: socials.allSocials.length,
      error: ''
    };
  } catch (err) {
    return buildErrorRow(url, String(err));
  }
}

function buildCandidatePages(baseUrl) {
  const u = new URL(baseUrl);
  const root = u.origin;

  return uniqueArray([
    root + '/',
    root + '/contact',
    root + '/contact-us',
    root + '/contactus',
    root + '/about',
    root + '/about-us',
    root + '/support'
  ]);
}

async function fetchPage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; BulkExtractorBot/3.0; +https://vercel.app/)'
      }
    });

    const code = response.status;

    if (code < 200 || code >= 400) {
      return { ok: false, url, code };
    }

    const html = cleanupContent(await response.text());

    return {
      ok: true,
      url,
      code,
      html,
      text: htmlToText(html),
      title: extractTitle(html),
      links: extractAllUrlsFromHtml(html, url),
      telLinks: extractTelLinks(html),
      mailtoEmails: extractMailtoEmails(html)
    };
  } catch (e) {
    return { ok: false, url, code: 0, error: String(e && e.name === 'AbortError' ? 'Timeout' : e) };
  } finally {
    clearTimeout(timer);
  }
}

function buildErrorRow(url, message) {
  return {
    url,
    status: 'Failed',
    title: '',
    emails: [],
    phones: [],
    facebook: [],
    instagram: [],
    linkedin: [],
    twitter: [],
    youtube: [],
    tiktok: [],
    pinterest: [],
    whatsapp: [],
    telegram: [],
    allSocials: [],
    crawledPages: [],
    emailCount: 0,
    phoneCount: 0,
    socialCount: 0,
    error: message
  };
}

function cleanupContent(input) {
  return String(input || '')
    .replace(/\\u0022/g, '"')
    .replace(/\\u003c/gi, '<')
    .replace(/\\u003e/gi, '>')
    .replace(/\\u0026/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#34;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#x2F;/gi, '/')
    .replace(/\\\//g, '/');
}

function htmlToText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTitle(html) {
  const match = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? cleanText(match[1]) : '';
}

function cleanText(text) {
  return cleanupContent(String(text || '')).replace(/\s+/g, ' ').trim();
}

function uniqueArray(arr) {
  const out = [];
  const seen = new Set();

  for (const itemRaw of arr || []) {
    const item = String(itemRaw || '').trim();
    const key = item.toLowerCase();
    if (item && !seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }

  return out;
}

function cleanupPossibleEmail(email) {
  return cleanupContent(String(email || ''))
    .replace(/^mailto:/i, '')
    .replace(/[<>"'\\]/g, '')
    .replace(/[;,]+$/g, '')
    .trim();
}

function isLikelyEmail(email) {
  const e = String(email || '').toLowerCase();
  if (!/^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/i.test(e)) return false;
  if (e.includes('.png')) return false;
  if (e.includes('.jpg')) return false;
  if (e.includes('.jpeg')) return false;
  if (e.includes('.svg')) return false;
  if (e.includes('.webp')) return false;
  if (e.includes('example.com')) return false;
  if (e.includes('@2x')) return false;
  return true;
}

function extractMailtoEmails(html) {
  const regex = /mailto:([^"'?\s#<]+)/gi;
  const out = [];
  let match;

  while ((match = regex.exec(String(html || ''))) !== null) {
    const email = cleanupPossibleEmail(match[1]);
    if (isLikelyEmail(email)) out.push(email);
  }

  return uniqueArray(out);
}

function extractEmails(html, mailtoEmails) {
  const cleaned = cleanupContent(html);
  const regex = /[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/gi;
  const matches = cleaned.match(regex) || [];
  let emails = [];

  for (const match of matches) {
    const email = cleanupPossibleEmail(match);
    if (isLikelyEmail(email)) emails.push(email);
  }

  emails = uniqueArray(emails.concat(mailtoEmails || []));
  emails.sort((a, b) => emailScore(b) - emailScore(a));
  return emails.slice(0, 20);
}

function emailScore(email) {
  const e = String(email || '').toLowerCase();
  let score = 0;
  if (e.indexOf('info@') === 0) score += 6;
  if (e.indexOf('contact@') === 0) score += 6;
  if (e.indexOf('support@') === 0) score += 5;
  if (e.indexOf('sales@') === 0) score += 5;
  if (e.indexOf('hello@') === 0) score += 4;
  if (e.indexOf('admin@') === 0) score += 3;
  if (e.indexOf('noreply@') === 0) score -= 6;
  if (e.indexOf('no-reply@') === 0) score -= 6;
  return score;
}

function extractTelLinks(html) {
  const regex = /tel:([^"'<\s]+)/gi;
  const out = [];
  let match;

  while ((match = regex.exec(String(html || ''))) !== null) {
    out.push(match[1]);
  }

  return uniqueArray(out);
}

function normalizePhone(raw) {
  let s = String(raw || '').trim().replace(/[^\d+]/g, '');
  if (s.indexOf('00') === 0) s = '+' + s.substring(2);
  if (s.charAt(0) !== '+') return '';

  const digits = s.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return '';
  if (/^(\d)\1{7,}$/.test(digits)) return '';
  if (/^(123456|000000|999999|111111)/.test(digits)) return '';

  return '+' + digits;
}

function looksLikeRealPhone(raw) {
  const n = normalizePhone(raw);
  if (!n) return false;
  const digits = n.replace(/\D/g, '');
  if (/^(\d)\1{7,}$/.test(digits)) return false;
  return true;
}

function extractPhones(html, text, telLinks) {
  let candidates = [];

  for (const tel of telLinks || []) {
    candidates.push(tel);
  }

  const strictIntlRegex = /(?:\+|00)\d{1,3}[\s\-()]*\d[\d\s\-()]{6,16}\d/g;
  const htmlMatches = String(html || '').match(strictIntlRegex) || [];
  const textMatches = String(text || '').match(strictIntlRegex) || [];

  candidates = candidates
    .concat(htmlMatches)
    .concat(textMatches)
    .map(normalizePhone)
    .filter(v => looksLikeRealPhone(v));

  candidates = uniqueArray(candidates);
  candidates.sort((a, b) => phoneScore(b) - phoneScore(a));
  return candidates.slice(0, 3);
}

function phoneScore(phone) {
  let score = String(phone || '').length;
  if (phone.indexOf('+1') === 0) score += 1;
  if (phone.indexOf('+44') === 0) score += 1;
  if (phone.indexOf('+92') === 0) score += 1;
  if (phone.indexOf('+971') === 0) score += 1;
  return score;
}

function cleanupUrl(url) {
  return cleanupContent(String(url || ''))
    .replace(/[<>"'\\]+$/g, '')
    .trim();
}

function toAbsoluteUrl(href, baseUrl) {
  try {
    const h = cleanupContent(String(href || ''));
    if (!h) return '';
    if (/^javascript:/i.test(h)) return '';
    if (/^mailto:/i.test(h)) return '';
    if (/^tel:/i.test(h)) return '';
    return new URL(h, baseUrl).toString();
  } catch (e) {
    return '';
  }
}

function extractAllUrlsFromHtml(html, baseUrl) {
  const links = [];
  const hrefRegex = /href\s*=\s*["']([^"']+)["']/gi;
  const rawUrlRegex = /https?:\/\/[^\s"'<>]+/gi;
  let match;

  while ((match = hrefRegex.exec(String(html || ''))) !== null) {
    const absolute = toAbsoluteUrl(match[1], baseUrl);
    if (absolute) links.push(absolute);
  }

  const rawMatches = String(html || '').match(rawUrlRegex) || [];
  for (const raw of rawMatches) {
    links.push(cleanupUrl(raw));
  }

  return uniqueArray(links);
}

function isBadSocialLink(link) {
  if (link.indexOf('/share') !== -1) return true;
  if (link.indexOf('/intent/') !== -1) return true;
  if (link.indexOf('/sharer') !== -1) return true;
  if (link.indexOf('/search?') !== -1) return true;
  return false;
}

function filterSocial(links, domains) {
  const out = [];

  for (const linkRaw of links || []) {
    const link = String(linkRaw || '');
    const lower = link.toLowerCase();

    for (const domain of domains) {
      if (lower.indexOf(domain) !== -1) {
        if (!isBadSocialLink(lower)) out.push(link);
        break;
      }
    }
  }

  return uniqueArray(out);
}

function normalizeSocialArray(arr) {
  return uniqueArray(arr).slice(0, 10);
}

function extractSocialLinks(html, allLinks, baseUrl) {
  const links = uniqueArray((allLinks || []).concat(extractAllUrlsFromHtml(html, baseUrl)));

  const socials = {
    facebook: normalizeSocialArray(filterSocial(links, ['facebook.com'])),
    instagram: normalizeSocialArray(filterSocial(links, ['instagram.com'])),
    linkedin: normalizeSocialArray(filterSocial(links, ['linkedin.com', 'lnkd.in'])),
    twitter: normalizeSocialArray(filterSocial(links, ['twitter.com', 'x.com'])),
    youtube: normalizeSocialArray(filterSocial(links, ['youtube.com', 'youtu.be'])),
    tiktok: normalizeSocialArray(filterSocial(links, ['tiktok.com'])),
    pinterest: normalizeSocialArray(filterSocial(links, ['pinterest.com'])),
    whatsapp: normalizeSocialArray(filterSocial(links, ['wa.me', 'whatsapp.com'])),
    telegram: normalizeSocialArray(filterSocial(links, ['t.me', 'telegram.me', 'telegram.org']))
  };

  socials.allSocials = uniqueArray(
    socials.facebook
      .concat(socials.instagram)
      .concat(socials.linkedin)
      .concat(socials.twitter)
      .concat(socials.youtube)
      .concat(socials.tiktok)
      .concat(socials.pinterest)
      .concat(socials.whatsapp)
      .concat(socials.telegram)
  );

  return socials;
}

async function asyncPool(limit, items, iteratorFn) {
  const ret = [];
  const executing = [];

  for (const item of items) {
    const p = Promise.resolve().then(() => iteratorFn(item));
    ret.push(p);

    if (limit <= items.length) {
      const e = p.then(() => {
        const index = executing.indexOf(e);
        if (index >= 0) executing.splice(index, 1);
      });

      executing.push(e);

      if (executing.length >= limit) {
        await Promise.race(executing);
      }
    }
  }

  return Promise.all(ret);
}
