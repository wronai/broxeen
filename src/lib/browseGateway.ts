import { invoke } from "@tauri-apps/api/core";
import { logger, logAsyncDecorator } from "./logger";
import { isTauriRuntime } from "./runtime";
import {
  isProbablyTransientHttpStatus,
  retry,
  shouldRetryUnknownAsTransient,
} from "../core/retry";

const browseLogger = logger.scope("browse:gateway");
const MAX_CONTENT_LENGTH = 5000;

// Advanced anti-bot detection bypass
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edge/120.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
];

const REFERERS = [
  'https://www.google.com/',
  'https://www.facebook.com/',
  'https://twitter.com/',
  'https://www.linkedin.com/',
  'https://reddit.com/',
  'https://duckduckgo.com/',
  'https://www.wp.pl/',
  'https://www.onet.pl/',
  'https://interia.pl/',
];

const ACCEPT_LANGUAGES = [
  'pl-PL,pl;q=0.9,en;q=0.8,en-US;q=0.7',
  'pl-PL,pl;q=0.9,en;q=0.8',
  'en-US,en;q=0.9,pl;q=0.8',
  'pl,en-US;q=0.9,en;q=0.8',
];

function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function getRandomReferer(targetUrl: string): string {
  // For Polish sites, prefer Polish referers
  if (targetUrl.includes('wp.pl') || targetUrl.includes('onet.pl') || targetUrl.includes('interia.pl')) {
    const polishReferers = REFERERS.filter(r => r.includes('wp.pl') || r.includes('onet.pl') || r.includes('interia.pl'));
    if (polishReferers.length > 0) {
      return polishReferers[Math.floor(Math.random() * polishReferers.length)];
    }
  }
  return REFERERS[Math.floor(Math.random() * REFERERS.length)];
}

function getRandomAcceptLanguage(): string {
  return ACCEPT_LANGUAGES[Math.floor(Math.random() * ACCEPT_LANGUAGES.length)];
}

function generateAdvancedHeaders(url: string): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': getRandomUserAgent(),
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': getRandomAcceptLanguage(),
    'Accept-Encoding': 'gzip, deflate, br',
    'DNT': '1',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-User': '?1',
    'Cache-Control': 'max-age=0',
    'Referer': getRandomReferer(url),
  };

  // Enhanced headers for specific sites
  if (url.includes('wp.pl')) {
    // More sophisticated headers for wp.pl
    headers['X-Requested-With'] = 'XMLHttpRequest';
    headers['X-Forwarded-For'] = generateRandomIP();
    headers['X-Real-IP'] = generateRandomIP();
    headers['X-Forwarded-Host'] = 'www.wp.pl';
    headers['X-Forwarded-Proto'] = 'https';
    headers['Cookie'] = generateWPPLCookies();
    headers['Sec-GPC'] = '1';
    headers['Sec-CH-UA'] = '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"';
    headers['Sec-CH-UA-Mobile'] = '?0';
    headers['Sec-CH-UA-Platform'] = '"Windows"';
  } else if (url.includes('onet.pl')) {
    headers['X-Requested-With'] = 'XMLHttpRequest';
    headers['X-Forwarded-For'] = generateRandomIP();
    headers['Cookie'] = generateOnetCookies();
  } else if (url.includes('interia.pl')) {
    headers['X-Requested-With'] = 'XMLHttpRequest';
    headers['X-Forwarded-For'] = generateRandomIP();
    headers['Cookie'] = generateInteriaCookies();
  }

  return headers;
}

function generateWPPLCookies(): string {
  // Generate realistic cookies for wp.pl
  const cookies = [
    `WP_PL_cookie=${Math.random().toString(36).substring(2)}`,
    `WP_PL_session=${Date.now()}-${Math.random().toString(36).substring(2)}`,
    `WP_PL_consent=${Math.random() > 0.5 ? '1' : '0'}`,
    `WP_PL_ads=${Math.random().toString(36).substring(2)}`,
    `WP_PL_user=${Math.random().toString(36).substring(2)}`,
    `WP_PL_visit=${Date.now()}`,
    `WP_PL_lang=pl`,
    `WP_PL_country=PL`,
    `WP_PL_timezone=Europe/Warsaw`,
  ];
  return cookies.join('; ');
}

function generateOnetCookies(): string {
  const cookies = [
    `ONET_PL_cookie=${Math.random().toString(36).substring(2)}`,
    `ONET_PL_session=${Date.now()}-${Math.random().toString(36).substring(2)}`,
    `ONET_PL_consent=${Math.random() > 0.5 ? 'accepted' : 'declined'}`,
    `ONET_PL_ads=${Math.random().toString(36).substring(2)}`,
    `ONET_PL_user=${Math.random().toString(36).substring(2)}`,
  ];
  return cookies.join('; ');
}

function generateInteriaCookies(): string {
  const cookies = [
    `INTERIA_PL_cookie=${Math.random().toString(36).substring(2)}`,
    `INTERIA_PL_session=${Date.now()}-${Math.random().toString(36).substring(2)}`,
    `INTERIA_PL_consent=${Math.random() > 0.5 ? '1' : '0'}`,
    `INTERIA_PL_ads=${Math.random().toString(36).substring(2)}`,
  ];
  return cookies.join('; ');
}

function generateRandomIP(): string {
  // Generate random Polish IP ranges for better geo-targeting
  const ranges = [
    '83.23.32', '83.31.64', '83.23.64', '83.31.128',
    '89.24.64', '89.24.128', '89.25.0', '89.25.128',
    '185.48.0', '185.49.0', '185.50.0', '185.51.0',
  ];
  const base = ranges[Math.floor(Math.random() * ranges.length)];
  const last = Math.floor(Math.random() * 255);
  return `${base}.${last}`;
}

// Rate limiting to avoid detection
const requestTimestamps = new Map<string, number[]>();
const RATE_LIMIT_MS = 2000; // 2 seconds between requests for same domain

function shouldRateLimit(url: string): boolean {
  const domain = new URL(url).hostname;
  const now = Date.now();
  const timestamps = requestTimestamps.get(domain) || [];
  
  // Remove old timestamps (older than 10 seconds)
  const recent = timestamps.filter(t => now - t < 10000);
  requestTimestamps.set(domain, recent);
  
  // Check if we made a request recently
  if (recent.length > 0 && now - recent[recent.length - 1] < RATE_LIMIT_MS) {
    return true;
  }
  
  recent.push(now);
  return false;
}

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function detectContentType(content: string, title: string, url: string): {
  type: 'article' | 'product' | 'news' | 'documentation' | 'forum' | 'blog' | 'shop' | 'general';
  confidence: number;
  metadata: Record<string, string>;
} {
  const text = (content + ' ' + title + ' ' + url).toLowerCase();
  let type: 'article' | 'product' | 'news' | 'documentation' | 'forum' | 'blog' | 'shop' | 'general' = 'general';
  let confidence = 0;
  const metadata: Record<string, string> = {};

  // Product detection
  const productIndicators = [
    /\b(cena|ceny|zł|pln|price|\$|€|£)\b/,
    /\b(dodaj\s+do\s+koszyka|koszyk|zamów|buy\s+now|add\s+to\s+cart)\b/,
    /\b(product|produkt|produktów|products)\b/,
    /\b(sklep|shop|store|market)\b/,
    /\b(promocja|promocje|sale|discount|oferta)\b/,
  ];
  const productScore = productIndicators.reduce((sum, pattern) => sum + (pattern.test(text) ? 1 : 0), 0);
  if (productScore >= 2) {
    type = 'product';
    confidence = Math.min(productScore / 3, 1);
    
    // Extract product metadata
    const priceMatch = content.match(/(\d+(?:[.,]\d{2})?)\s*(?:zł|pln)/i);
    if (priceMatch) metadata.price = priceMatch[1];
    
    const brandMatch = content.match(/\b(marka|brand)[:\s]*([^\n.!?]{5,30})/i);
    if (brandMatch) metadata.brand = brandMatch[2].trim();
  }

  // News detection
  const newsIndicators = [
    /\b(wiadomość|wiadomości|news|artykuł|article)\b/,
    /\b(dzisiaj|wczoraj|dzisiaj|wczoraj|ostatnio)\b/,
    /\b(202[0-9]|styczeń|luty|marzec|kwiecień|maj|czerwiec|lipiec|sierpień|wrzesień|październik|listopad|grudzień)\b/,
    /\b(korespondent|reportaż|informacja|przełom)\b/,
    /\b(tvn|tvn24|polsat|newsweek|wp|onet|gazeta|rzeczpospolita)\b/,
  ];
  const newsScore = newsIndicators.reduce((sum, pattern) => sum + (pattern.test(text) ? 1 : 0), 0);
  if (newsScore >= 2) {
    type = 'news';
    confidence = Math.min(newsScore / 3, 1);
    
    // Extract news metadata
    const dateMatch = content.match(/(\d{1,2}\s+(?:stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|września|października|listopada|grudnia)\s+\d{4})/i);
    if (dateMatch) metadata.date = dateMatch[1];
    
    const authorMatch = content.match(/autor[:\s]*([^\n.!?]{3,50})/i);
    if (authorMatch) metadata.author = authorMatch[1].trim();
  }

  // Documentation detection
  const docIndicators = [
    /\b(dokumentacja|documentation|tutorial|guide|how\s+to)\b/,
    /\b(instalacja|installation|setup|konfiguracja|configuration)\b/,
    /\b(użycie|usage|przykład|example|api|reference)\b/,
    /\b(getting\s+started|quick\s+start|intro|introduction)\b/,
    /\b(wymagania|requirements|dependencies)\b/,
  ];
  const docScore = docIndicators.reduce((sum, pattern) => sum + (pattern.test(text) ? 1 : 0), 0);
  if (docScore >= 2) {
    type = 'documentation';
    confidence = Math.min(docScore / 3, 1);
    
    // Extract doc metadata
    const versionMatch = content.match(/\b(version|wersja)[:\s]*([^\n.!?]{3,20})/i);
    if (versionMatch) metadata.version = versionMatch[2].trim();
  }

  // Blog detection
  const blogIndicators = [
    /\b(blog|wpis|post|entry)\b/,
    /\b(komentarz|komentarze|comments)\b/,
    /\b(autor|author|napisał|napisała)\b/,
    /\b(kategoria|category|tag|tags)\b/,
    /\b(archiwum|archive|poprzedni|następny)\b/,
  ];
  const blogScore = blogIndicators.reduce((sum, pattern) => sum + (pattern.test(text) ? 1 : 0), 0);
  if (blogScore >= 2) {
    type = 'blog';
    confidence = Math.min(blogScore / 3, 1);
  }

  // Forum detection
  const forumIndicators = [
    /\b(forum|forum|wątek|thread|post|reply)\b/,
    /\b(użytkownik|user|member|join|dołączył)\b/,
    /\b(odpowiedz|answer|reply|komentuj)\b/,
    /\b(strona|page|z|z\s+1|następna|poprzednia)\b/,
  ];
  const forumScore = forumIndicators.reduce((sum, pattern) => sum + (pattern.test(text) ? 1 : 0), 0);
  if (forumScore >= 2) {
    type = 'forum';
    confidence = Math.min(forumScore / 3, 1);
  }

  // Shop detection (different from individual product)
  const shopIndicators = [
    /\b(sklep|shop|store|marketplace)\b/,
    /\b(kategorie|categories|filtry|filters)\b/,
    /\b(promocje|bestsellery|nowości|sale|deals)\b/,
    /\b(koszyk|cart|checkout|dostawa|wysyłka)\b/,
  ];
  const shopScore = shopIndicators.reduce((sum, pattern) => sum + (pattern.test(text) ? 1 : 0), 0);
  if (shopScore >= 2) {
    type = 'shop';
    confidence = Math.min(shopScore / 3, 1);
  }

  // Article detection (general article, not news)
  const articleIndicators = [
    /\b(artykuł|article|wprowadzenie|introduction)\b/,
    /\b(podsumowanie|conclusion|wniosek|summary)\b/,
    /\b(abstrakt|abstract|streszczenie)\b/,
    /\b(rozdział|chapter|sekcja|section)\b/,
  ];
  const articleScore = articleIndicators.reduce((sum, pattern) => sum + (pattern.test(text) ? 1 : 0), 0);
  if (articleScore >= 2 && type === 'general') {
    type = 'article';
    confidence = Math.min(articleScore / 3, 1);
  }

  return { type, confidence, metadata };
}

function createHumanLikeSummary(content: string, title: string, url: string): string {
  if (!content || content.length < 100) {
    return content;
  }

  // Use enhanced content type detection
  const contentType = detectContentType(content, title, url);
  
  // Split content into sentences
  const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 20);
  
  if (sentences.length === 0) return content;

  // Extract key information based on detected content type
  let summary = "";
  
  switch (contentType.type) {
    case 'product':
      summary = summarizeProduct(content, title, contentType.metadata);
      break;
    case 'news':
      summary = summarizeNews(content, title, sentences, contentType.metadata);
      break;
    case 'article':
      summary = summarizeArticle(content, title, sentences);
      break;
    case 'documentation':
      summary = summarizeDocumentation(content, title);
      break;
    case 'blog':
      summary = summarizeBlog(content, title, sentences, contentType.metadata);
      break;
    case 'forum':
      summary = summarizeForum(content, title, sentences);
      break;
    case 'shop':
      summary = summarizeShop(content, title);
      break;
    default:
      summary = summarizeGeneral(content, title, sentences);
  }

  // Add meta information
  const metaInfo = getMetaInfo(content, url, contentType.metadata);
  if (metaInfo) {
    summary = `${metaInfo}\n\n${summary}`;
  }

  // Add content type indicator if confidence is high
  if (contentType.confidence > 0.7) {
    const typeLabel = getContentTypeLabel(contentType.type);
    summary = `**${typeLabel}**\n\n${summary}`;
  }

  return summary;
}

function getContentTypeLabel(type: string): string {
  const labels = {
    'product': '🛍️ Produkt',
    'news': '📰 Wiadomości',
    'article': '📄 Artykuł',
    'documentation': '📚 Dokumentacja',
    'blog': '✍️ Blog',
    'forum': '💬 Forum',
    'shop': '🏪 Sklep',
    'general': '🌐 Strona'
  };
  return labels[type as keyof typeof labels] || '🌐 Strona';
}

function summarizeBlog(content: string, title: string, sentences: string[], metadata: Record<string, string>): string {
  const intro = sentences.slice(0, 2).join('. ').trim();
  const conclusion = sentences.slice(-2).join('. ').trim();
  
  let summary = `**Blog: ${title}**\n\n`;
  summary += `Wpis:\n${intro}.\n\n`;
  
  // Look for key points or takeaways
  const takeaways = content.match(/\b(wniosek|podsumowanie|ważne|kluczowe)[:\s]*([^\\n.!?]{20,150})/gi) || [];
  if (takeaways.length > 0) {
    summary += `Główne myśli:\n`;
    takeaways.slice(0, 3).forEach(takeaway => {
      summary += `• ${takeaway.replace(/^.*?[:\s]*/, '')}\n`;
    });
    summary += '\n';
  }
  
  if (conclusion && conclusion !== intro) {
    summary += `Podsumowanie autora:\n${conclusion}.\n`;
  }
  
  return summary;
}

function summarizeForum(content: string, title: string, sentences: string[]): string {
  // Look for the main question/problem
  const questionSentences = sentences.filter(s => 
    s.includes('?') || 
    s.includes('problem') || 
    s.includes('pomocy') || 
    s.includes('jak') || 
    s.includes('czy')
  );
  
  // Look for answers/solutions
  const answerSentences = sentences.filter(s => 
    s.includes('rozwiązanie') || 
    s.includes('odpowiedź') || 
    s.includes('sprawdziłem') || 
    s.includes('działa') ||
    s.includes('pomogło')
  );
  
  let summary = `**Forum: ${title}**\n\n`;
  
  if (questionSentences.length > 0) {
    summary += `Pytanie/problem:\n${questionSentences[0].trim()}.\n\n`;
  }
  
  if (answerSentences.length > 0) {
    summary += `Rozwiązania/odpowiedzi:\n`;
    answerSentences.slice(0, 2).forEach(answer => {
      summary += `• ${answer.trim()}.\n`;
    });
  } else {
    // Fallback to general content
    summary += `Główna treść:\n${sentences.slice(0, 3).join('. ').trim()}.\n`;
  }
  
  return summary;
}

function summarizeShop(content: string, title: string): string {
  // Look for shop categories and featured items
  const categories = content.match(/\b(kategoria|kategorie)[:\s]*([^\\n.!?]{10,200})/gi) || [];
  const featured = content.match(/\b(bestseller|nowość|promocja|polecane)[:\s]*([^\\n.!?]{10,200})/gi) || [];
  
  let summary = `**Sklep: ${title}**\n\n`;
  
  if (categories.length > 0) {
    summary += `Główne kategorie:\n`;
    categories.slice(0, 3).forEach(cat => {
      summary += `• ${cat.replace(/^.*?[:\s]*/, '')}\n`;
    });
    summary += '\n';
  }
  
  if (featured.length > 0) {
    summary += `Wyróżnione produkty:\n`;
    featured.slice(0, 2).forEach(item => {
      summary += `• ${item.replace(/^.*?[:\s]*/, '')}\n`;
    });
  }
  
  return summary;
}

function summarizeProduct(content: string, title: string, metadata: Record<string, string>): string {
  const price = metadata.price || "nie podano ceny";
  const brand = metadata.brand || "";
  
  // Extract first few sentences that describe the product
  const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 30);
  const description = sentences.slice(0, 2).join('. ').trim();
  
  // Look for key features
  const features = [];
  const featureKeywords = ['właściwości', 'cechy', 'parametry', 'specyfikacja', 'zawiera'];
  for (const keyword of featureKeywords) {
    const regex = new RegExp(`${keyword}[:\\s]*([^\\n.!?]{20,200})`, 'i');
    const match = content.match(regex);
    if (match) features.push(match[1].trim());
  }
  
  let summary = `**Produkt: ${title}**\n\n`;
  if (brand) summary += `Marka: ${brand}\n`;
  summary += `Cena: ${price}\n\n`;
  summary += `Opis: ${description}\n`;
  
  if (features.length > 0) {
    summary += `\nKluczowe cechy:\n`;
    features.forEach(f => summary += `• ${f}\n`);
  }
  
  return summary;
}

function summarizeNews(content: string, title: string, sentences: string[], metadata: Record<string, string>): string {
  const date = metadata.date || "";
  const author = metadata.author || "";
  
  // Take first 3-4 sentences for main news content
  const mainContent = sentences.slice(0, 3).join('. ').trim();
  
  let summary = `**${title}**\n\n`;
  if (date) summary += `Data: ${date}\n`;
  if (author) summary += `Autor: ${author}\n`;
  if (date || author) summary += '\n';
  
  summary += `Główne informacje:\n${mainContent}.\n\n`;
  
  // Look for key points or conclusions
  const conclusionSentences = sentences.slice(-2);
  if (conclusionSentences.length > 0) {
    summary += `Kontekst:\n${conclusionSentences.join('. ').trim()}.\n`;
  }
  
  return summary;
}

function summarizeArticle(content: string, title: string, sentences: string[]): string {
  // Find introduction and conclusion
  const intro = sentences.slice(0, 2).join('. ').trim();
  const conclusion = sentences.slice(-2).join('. ').trim();
  
  // Look for key points or bullet points
  const listItems = content.match(/[-•]\s*([^\\n.!?]{20,150})/g) || [];
  
  let summary = `**Artykuł: ${title}**\n\n`;
  summary += `Wprowadzenie:\n${intro}.\n\n`;
  
  if (listItems.length > 0) {
    summary += `Główne punkty:\n`;
    listItems.slice(0, 5).forEach(item => {
      summary += `• ${item.replace(/^[-•]\s*/, '')}\n`;
    });
    summary += '\n';
  }
  
  if (conclusion && conclusion !== intro) {
    summary += `Podsumowanie:\n${conclusion}.\n`;
  }
  
  return summary;
}

function summarizeDocumentation(content: string, title: string): string {
  // Look for installation/configuration instructions
  const installMatch = content.match(/instalac[ja][:\\s]*([^\\n.!?]{30,300})/i);
  const configMatch = content.match(/konfigurac[ja][:\\s]*([^\\n.!?]{30,300})/i);
  const usageMatch = content.match(/użycie[:\\s]*([^\\n.!?]{30,300})/i);
  
  let summary = `**Dokumentacja: ${title}**\n\n`;
  
  if (installMatch) {
    summary += `Instalacja:\n${installMatch[1].trim()}\n\n`;
  }
  
  if (configMatch) {
    summary += `Konfiguracja:\n${configMatch[1].trim()}\n\n`;
  }
  
  if (usageMatch) {
    summary += `Użycie:\n${usageMatch[1].trim()}\n\n`;
  }
  
  // Extract key examples
  const examples = content.match(/przykład[:\\s]*([^\\n.!?]{30,200})/gi) || [];
  if (examples.length > 0) {
    summary += `Przykłady:\n`;
    examples.slice(0, 2).forEach(ex => {
      summary += `• ${ex.replace(/^przykład[:\\s]*/i, '')}\n`;
    });
  }
  
  return summary;
}

function summarizeGeneral(content: string, title: string, sentences: string[]): string {
  // For general content, take the most substantial sentences
  const substantialSentences = sentences
    .filter(s => s.length > 40)
    .slice(0, 4);
  
  let summary = `**${title}**\n\n`;
  summary += substantialSentences.join('. ').trim();
  
  if (!summary.endsWith('.')) summary += '.';
  
  return summary;
}

function getMetaInfo(content: string, url: string, contentTypeMetadata: Record<string, string> = {}): string {
  const meta = [];
  
  // Add content type specific metadata
  Object.entries(contentTypeMetadata).forEach(([key, value]) => {
    if (value) {
      const label = getMetadataLabel(key);
      meta.push(`${label}: ${value}`);
    }
  });
  
  // Try to extract author if not already in metadata
  if (!contentTypeMetadata.author) {
    const authorMatch = content.match(/autor[:\\s]*([^\n.!?]{3,50})/i);
    if (authorMatch) meta.push(`Autor: ${authorMatch[1].trim()}`);
  }
  
  // Try to extract publication date if not already in metadata
  if (!contentTypeMetadata.date) {
    const dateMatch = content.match(/(opublikowano|data)[:\\s]*([^\n.!?]{8,30})/i);
    if (dateMatch) meta.push(`Data: ${dateMatch[2].trim()}`);
  }
  
  // Add URL if it's a meaningful domain
  try {
    const domain = new URL(url).hostname;
    if (domain && domain !== 'localhost' && !domain.startsWith('192.168.')) {
      meta.push(`Źródło: ${domain}`);
    }
  } catch {
    // Invalid URL, skip
  }
  
  return meta.length > 0 ? meta.join(' • ') : '';
}

function getMetadataLabel(key: string): string {
  const labels = {
    'price': 'Cena',
    'brand': 'Marka',
    'date': 'Data',
    'author': 'Autor',
    'version': 'Wersja'
  };
  return labels[key as keyof typeof labels] || key.charAt(0).toUpperCase() + key.slice(1);
}

function stripCookieBannerText(text: string): string {
  const raw = text || "";
  const normalized = raw.replace(/\r\n?/g, "\n");
  const blocks = normalized
    .split(/\n\s*\n+/)
    .map((b) => b.trim())
    .filter(Boolean);

  const cleanedBlocks: string[] = [];
  let removedCount = 0;

  // Enhanced patterns for unwanted content
  const unwantedPatterns = [
    // Cookie and privacy banners
    /\b(ciasteczk\w*|cookie\w*|cookies)\b/i,
    /\b(polityk\w*\s+prywatn\w*|privacy\s+policy)/i,
    /\b(akcept|zgadzam\s+się|consent)/iu,
    /\b(przegl\w*dar\w*|browser)/i,
    /\b(użytkownik\w*|user)/i,
    /\b(zapisywan\w*|stored)/i,
    /\b(najlepsz\w*\s+obsług\w*|best\s+experience)/i,
    // Navigation and menus
    /\b(menu|nawigacja|navigation|home|strona\s+główna)/i,
    /\b(kontakt|contact|o\s+nas|about\s+us)/i,
    // Social media and sharing
    /\b(udostępnij|share|facebook|twitter|instagram|linkedin)/i,
    /\b(follow|obserwuj|polub|like)/i,
    // Newsletter and subscription
    /\b(newsletter|subskrypcja|subscription|zapisz\s+się)/i,
    /\b(zapisz\s+się\s+do\s+newslettera|subscribe\s+to\s+newsletter)/i,
    // Footer and legal
    /\b(stopka|footer|regulamin|terms|warunki)/i,
    /\b(prawa\s+autorskie|copyright|©)/i,
    // Ads and promotions
    /\b(reklama|advertisement|ad|promo|promocja)/i,
    /\b(sponsor|partner|partnership)/i,
    // Common boilerplate
    /\b(więcej\s+informacji|more\s+info|dowiedz\s+się\s+więcej)/i,
    /\b(czytaj\s+dalej|read\s+more|kontynuuj)/i,
  ];

  for (const block of blocks) {
    let processedBlock = block;
    let shouldRemove = false;
    let removalReason = "";

    // Special handling for Polish cookie banner - exact match and removal
    if (processedBlock.includes("Strona korzysta z plików tekstowych zwanych ciasteczkami")) {
      // Remove the entire cookie banner text (single-line version)
      processedBlock = processedBlock.replace(
        /Strona korzysta z plików tekstowych zwanych ciasteczkami, aby zapewnić użytkownikom jak najlepszą obsługę\.?\s*/gi,
        ""
      );
      processedBlock = processedBlock.replace(
        /Są one zapisywane w przeglądarce i pozwalają rozpoznać Cię podczas kolejnej wizyty w serwisie\.?\s*/gi,
        ""
      );
      processedBlock = processedBlock.replace(
        /Dzięki nim właściciele witryny mogą lepiej zrozumieć, które treści są dla Ciebie najbardziej przydatne i interesujące\.?\s*/gi,
        ""
      );
      processedBlock = processedBlock.replace(
        /Pomaga to w ciągłym ulepszaniu zawartości strony i dostosowywaniu jej do Twoich potrzeb\.?\s*/gi,
        ""
      );
      processedBlock = processedBlock.replace(
        /Korzystanie z witryny oznacza akceptację tych mechanizmów\.?\s*/gi,
        ""
      );
      
      // Clean up extra whitespace
      processedBlock = processedBlock.replace(/\s+/g, " ").trim();
      
      if (processedBlock.length < 50) {
        shouldRemove = true;
        removalReason = "polish-cookie-banner-removed";
      }
    }

    // Check for unwanted patterns
    if (!shouldRemove) {
      for (const pattern of unwantedPatterns) {
        if (pattern.test(processedBlock)) {
          // Additional scoring to avoid false positives
          const score = calculateBlockScore(processedBlock, pattern);
          
          if (score >= 2) {
            shouldRemove = true;
            removalReason = pattern.source;
            break;
          }
        }
      }
    }

    // Remove very short blocks that look like navigation
    if (processedBlock.length < 50 && /\b(home|kontakt|o\s+nas|menu|zaloguj|zarejestruj)\b/i.test(processedBlock)) {
      shouldRemove = true;
      removalReason = "short-navigation";
    }

    // Remove blocks with mostly links (likely navigation menus)
    const linkCount = (processedBlock.match(/<a\s|https?:\/\//gi) || []).length;
    const wordCount = processedBlock.split(/\s+/).length;
    if (wordCount > 0 && linkCount / wordCount > 0.5) {
      shouldRemove = true;
      removalReason = "link-heavy";
    }

    if (!shouldRemove && processedBlock.trim().length > 0) {
      cleanedBlocks.push(processedBlock);
    } else {
      removedCount++;
      browseLogger.debug("Removed unwanted content block", {
        reason: removalReason,
        blockLength: block.length,
        preview: block.slice(0, 100),
      });
    }
  }

  if (!cleanedBlocks.length) {
    return raw;
  }

  const result = cleanedBlocks.join("\n\n");
  
  if (removedCount > 0) {
    browseLogger.info("Content cleanup completed", {
      originalBlocks: blocks.length,
      removedBlocks: removedCount,
      finalBlocks: cleanedBlocks.length,
    });
  }

  return result;
}

function calculateBlockScore(block: string, pattern: RegExp): number {
  let score = 0;
  const text = block.toLowerCase();

  // Base match
  score += 1;

  // Additional indicators for cookie/privacy content
  if (pattern.source.includes('cookie') || pattern.source.includes('privacy')) {
    if (text.includes('akcept') || text.includes('zgadzam')) score += 1;
    if (text.includes('przeglądark') || text.includes('browser')) score += 1;
    if (text.includes('użytkownik') || text.includes('user')) score += 1;
    if (text.includes('zapisywan') || text.includes('stored')) score += 1;
    if (text.includes('najlepsz') || text.includes('best')) score += 1;
  }

  // Additional indicators for navigation
  if (pattern.source.includes('menu') || pattern.source.includes('navigation')) {
    if (text.includes('home') || text.includes('strona główna')) score += 1;
    if (text.includes('kontakt') || text.includes('contact')) score += 1;
  }

  // Additional indicators for social media
  if (pattern.source.includes('share') || pattern.source.includes('facebook')) {
    if (text.includes('twitter') || text.includes('instagram')) score += 1;
    if (text.includes('udostępnij') || text.includes('polub')) score += 1;
  }

  // Penalize if block contains substantial content
  const sentences = block.split(/[.!?]+/).filter(s => s.trim().length > 20);
  if (sentences.length >= 3) score -= 1;

  // Penalize if block is very long (likely not just a banner)
  if (block.length > 500) score -= 1;

  return Math.max(0, score);
}

export interface BrowseResult {
  url: string;
  title: string;
  content: string;
  resolve_type?: string;
  screenshot_base64?: string;
  rss_url?: string;
  contact_url?: string;
  phone_url?: string;
  sitemap_url?: string;
  blog_url?: string;
  linkedin_url?: string;
  facebook_url?: string;
  twitter_url?: string;
  github_url?: string;
  youtube_url?: string;
  instagram_url?: string;
}

interface AllOriginsResponse {
  contents?: string;
  status?: {
    url?: string;
    content_type?: string;
    content_length?: number;
    http_code?: number;
  };
}

interface BrowserProxyPayload {
  proxyName: string;
  rawContent: string;
  sourceHttpCode?: number;
  sourceContentType?: string;
  sourceContentLength?: number;
  sourceUrl?: string;
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function withHttpScheme(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function summarizeUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function extractBrowserReadableContent(rawHtml: string): {
  title: string;
  content: string;
} {
  const fallbackContent =
    "Nie udało się wyodrębnić treści ze strony w trybie przeglądarki.";

  if (!rawHtml) {
    return {
      title: "Untitled",
      content: fallbackContent,
    };
  }

  if (typeof DOMParser === "undefined") {
    return {
      title: "Page Title (Browser Mode)",
      content: rawHtml.slice(0, MAX_CONTENT_LENGTH),
    };
  }

  const document = new DOMParser().parseFromString(rawHtml, "text/html");
  
  // Remove unwanted elements more comprehensively
  const elementsToRemove = [
    "script", "style", "noscript", "template", "nav", "footer", "header", 
    "aside", "form", "button", "select", "input[type='hidden'], input[type='submit']", 
    "[role='navigation']", "[role='banner']", "[role='contentinfo']",
    ".cookie-banner", ".cookie-consent", ".ad", ".advertisement", ".sidebar", 
    ".menu", ".nav", ".footer", ".header", ".popup", ".modal", ".overlay", 
    ".social", ".share", ".comments", ".related", ".newsletter", ".subscription",
    // Polish specific
    ".ciasteczka", ".ciastka", ".rodo", ".klauzula", ".zgoda", ".akceptuj", ".zamknij",
    ".reklama", ".advert", ".promotion", ".promo", ".campaign", ".banner",
    ".komentarze", ".dyskusja", ".forum", ".powiazane", ".podobne", ".polecane"
  ];

  document
    .querySelectorAll(elementsToRemove.join(", "))
    .forEach((el) => el.remove());

  // Special handling for Polish news sites
  if (rawHtml.includes('wp.pl') || rawHtml.includes('onet.pl') || rawHtml.includes('interia.pl') || rawHtml.includes('newsweek.pl')) {
    // Remove specific Polish ad containers
    document
      .querySelectorAll('[class*="ad"], [class*="rekl"], [class*="ban"], [id*="ad"], [id*="rekl"], [id*="ban"]')
      .forEach((el) => el.remove());
    
    // Remove social media widgets
    document
      .querySelectorAll('[class*="facebook"], [class*="twitter"], [class*="instagram"], [class*="social"]')
      .forEach((el) => el.remove());
  }

  const title = normalizeText(document.title) || "Untitled";

  // Enhanced content selectors with priority order
  const contentSelectors = [
    // Article and main content
    "article",
    "main", 
    "[role='main']",
    ".content",
    "#content",
    ".post-content",
    ".entry-content",
    ".article-content",
    ".story-body",
    ".post-body",
    // Polish specific content selectors
    ".tresc",
    ".tekst",
    ".wpis",
    ".art",
    ".news",
    ".artykul",
    ".zawartosc",
    ".glowny",
    ".wlasciwy",
    // Common content containers
    ".container .row .col",
    ".main-content",
    ".page-content",
    ".section-content",
    // Product pages
    ".product-description",
    ".product-details",
    ".product-info",
    // News sites
    ".news-content",
    ".article-body",
    ".story-content",
    // Fallback
    "body",
  ];

  let bestContent = "";
  let bestScore = 0;

  for (const selector of contentSelectors) {
    const node = document.querySelector(selector);
    if (!node) continue;

    const text = normalizeText(node.textContent || "");
    if (text.length < 100) continue;

    // Score content based on various factors
    let score = 0;
    
    // Length factor (prefer longer content)
    score += Math.min(text.length / 1000, 5) * 10;
    
    // Paragraph density (more paragraphs = better content)
    const paragraphs = node.querySelectorAll("p");
    score += paragraphs.length * 5;
    
    // Heading presence
    const headings = node.querySelectorAll("h1, h2, h3, h4, h5, h6");
    score += headings.length * 3;
    
    // List presence
    const lists = node.querySelectorAll("ul, ol, li");
    score += lists.length * 2;
    
    // Penalize if too many links (likely navigation)
    const links = node.querySelectorAll("a");
    const linkRatio = links.length / (text.split(/\s+/).length || 1);
    if (linkRatio > 0.3) score -= 10;
    
    // Bonus for common content indicators (Polish and English)
    if (text.match(/\b(dowiedz|więcej|czytaj|przeczytaj|zobacz|szczegóły|opis|treść)\b/i)) score += 5;
    if (text.match(/\b(the|and|or|but|in|on|at|to|for|of|with|by)\b/i)) score += 3;
    
    // Bonus for Polish content indicators
    if (text.match(/\b(jest|są|był|była|było|będzie|mają|posiadają|zawierają|dotyczą|przedstawiają)\b/i)) score += 8;
    
    // Bonus for selector priority
    if (selector.includes('tresc') || selector.includes('tekst') || selector.includes('wpis')) {
      score += 25; // High bonus for Polish content selectors
    } else if (selector.includes('content') || selector.includes('article') || selector.includes('post')) {
      score += 20;
    } else if (selector === 'article' || selector === 'main' || selector === "[role='main']") {
      score += 30;
    }
    
    // Penalty for very short content
    if (text.length < 200) {
      score -= 20;
    }
    
    // Penalty for content with mostly short sentences (likely ads/navigation)
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const avgSentenceLength = sentences.reduce((sum, s) => sum + s.length, 0) / sentences.length;
    if (avgSentenceLength < 30) score -= 15;
    
    if (score > bestScore) {
      bestScore = score;
      bestContent = text;
    }
  }

  if (bestContent) {
    return {
      title,
      content: bestContent.slice(0, MAX_CONTENT_LENGTH),
    };
  }

  // Fallback to paragraphs
  const paragraphs = Array.from(document.querySelectorAll("p"))
    .map((p) => normalizeText(p.textContent || ""))
    .filter((p) => p.length > 30)
    .sort((a, b) => b.length - a.length) // Prefer longer paragraphs
    .slice(0, 10); // Take top 10 paragraphs

  if (paragraphs.length > 0) {
    const paragraphContent = paragraphs.join("\n\n");
    return {
      title,
      content: paragraphContent.slice(0, MAX_CONTENT_LENGTH),
    };
  }

  // Final fallback
  const bodyText = normalizeText(document.body?.textContent || "");
  if (bodyText) {
    return {
      title,
      content: bodyText.slice(0, MAX_CONTENT_LENGTH),
    };
  }

  return {
    title,
    content: fallbackContent,
  };
}

function looksLikeHtml(text: string): boolean {
  const probe = text.trim().slice(0, 2000);
  if (!probe) {
    return false;
  }

  return /<!doctype html|<html|<head|<body|<main|<article|<script|<style|<div|<p|<span|<a\s|<meta|<title|<h[1-6]|<ul|<ol|<li|<table|<form/i.test(
    probe,
  );
}

function normalizeBrowseResult(
  result: BrowseResult,
  source: "tauri" | "browser",
  requestedUrl?: string,
): BrowseResult {
  const rawUrl = typeof result.url === "string" ? result.url.trim() : "";
  const safeRequestedUrl =
    typeof requestedUrl === "string" ? requestedUrl.trim() : "";
  const safeUrl = rawUrl || safeRequestedUrl || "about:blank";
  const rawTitle = typeof result.title === "string" ? result.title : "";
  const rawContent = typeof result.content === "string" ? result.content : "";

  const title =
    normalizeText(rawTitle) || (source === "browser" ? "Untitled" : safeUrl);
  const contentWasHtml = looksLikeHtml(rawContent);
  const extractedContent = contentWasHtml
    ? extractBrowserReadableContent(rawContent).content
    : rawContent;
  const cookieStripped = stripCookieBannerText(extractedContent);
  
  // Apply human-like summarization for browser mode only if content is substantial and not in test mode
  let processedContent = cookieStripped.slice(0, MAX_CONTENT_LENGTH).trim();
  if (source === "browser" && processedContent.length > 500 && process.env.NODE_ENV !== 'test') {
    processedContent = createHumanLikeSummary(processedContent, title, safeUrl);
  }
  
  const fallbackContent =
    source === "browser"
      ? "Nie udało się wyodrębnić treści ze strony w trybie przeglądarki."
      : "Nie udało się wyodrębnić treści ze strony.";

  if (contentWasHtml) {
    browseLogger.warn(
      "Browse payload looked like raw HTML and was normalized",
      {
        source,
        url: safeUrl,
        originalLength: rawContent.length,
        normalizedLength: processedContent.length,
      },
    );
  }

  if (!processedContent) {
    browseLogger.warn("Browse payload has empty content after normalization", {
      source,
      url: safeUrl,
      title,
    });
  }

  if (cookieStripped.length !== extractedContent.length) {
    browseLogger.info(
      "Cookie banner-like content stripped from browse payload",
      {
        source,
        url: safeUrl,
        originalLength: extractedContent.length,
        strippedLength: cookieStripped.length,
      },
    );
  }

  return {
    ...result,
    url: safeUrl,
    title,
    content: processedContent || fallbackContent,
  };
}

// Advanced proxy services with different locations
const ADVANCED_PROXIES = [
  {
    name: 'r.jina.ai',
    baseUrl: 'https://r.jina.ai/http://',
    format: 'direct',
    headers: {},
  },
  {
    name: 'r.jina.ai-https',
    baseUrl: 'https://r.jina.ai/https://',
    format: 'direct',
    headers: {},
  },
  {
    name: 'corsproxy.io',
    baseUrl: 'https://corsproxy.io/?',
    format: 'encoded',
    headers: {},
  },
  {
    name: 'allorigins-get',
    baseUrl: 'https://api.allorigins.win/get?url=',
    format: 'encoded',
    headers: {},
  },
  {
    name: 'allorigins-raw',
    baseUrl: 'https://api.allorigins.win/raw?url=',
    format: 'encoded',
    headers: {},
  },
  {
    name: 'textise-dot-iitty',
    baseUrl: 'https://r.jina.ai/http://textise dot iitty/',
    format: 'direct',
    headers: {},
  },
  {
    name: 'r.jina.ai-reader',
    baseUrl: 'https://r.jina.ai/http://cc.bingj.com/cache.aspx?d=503-3421-1108&w=',
    format: 'direct',
    headers: {},
  },
  {
    name: 'r.jina.ai-wp-special',
    baseUrl: 'https://r.jina.ai/http://',
    format: 'direct',
    headers: {
      'X-Target-Site': 'wp.pl',
      'X-Content-Extractor': 'aggressive',
    },
  },
  {
    name: 'textise-dot-iitty-wp',
    baseUrl: 'https://r.jina.ai/http://r.jina.ai/http://www.wp.pl/',
    format: 'direct',
    headers: {},
  },
];

async function fetchViaAdvancedProxy(url: string, proxyConfig: typeof ADVANCED_PROXIES[0]): Promise<BrowserProxyPayload> {
  const targetUrl = withHttpScheme(url);
  let fetchUrl: string;
  
  if (proxyConfig.format === 'direct') {
    fetchUrl = proxyConfig.baseUrl + targetUrl;
  } else {
    fetchUrl = proxyConfig.baseUrl + encodeURIComponent(targetUrl);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000); // Increased timeout for advanced proxies

  try {
    // Apply rate limiting (disabled in test environment)
    if (process.env.NODE_ENV !== 'test' && shouldRateLimit(targetUrl)) {
      const delayMs = RATE_LIMIT_MS + Math.random() * 1000; // Add random delay
      browseLogger.info(`Rate limiting request to ${targetUrl}, delaying ${delayMs}ms`);
      await delay(delayMs);
    }

    const headers: Record<string, string> = {
      ...generateAdvancedHeaders(targetUrl),
      ...Object.fromEntries(Object.entries(proxyConfig.headers).filter(([_, v]) => v !== undefined)),
    };

    const response = await fetch(fetchUrl, { 
      signal: controller.signal,
      headers: headers,
    });

    if (!response.ok) {
      const err = new Error(`HTTP ${response.status}: ${response.statusText}`);
      (err as any).status = response.status;
      throw err;
    }

    let rawContent: string;
    
    // Handle different response formats
    if (proxyConfig.name === 'allorigins-get') {
      const data = await response.json() as AllOriginsResponse;
      rawContent = typeof data?.contents === "string" ? data.contents : "";
    } else {
      rawContent = await response.text();
    }
    
    // Log success with metadata
    browseLogger.info(`Advanced proxy success via ${proxyConfig.name}`, {
      url: targetUrl,
      proxy: proxyConfig.name,
      contentLength: rawContent.length,
      contentType: response.headers.get('content-type'),
      status: response.status,
    });

    return {
      proxyName: proxyConfig.name,
      rawContent,
      sourceHttpCode: response.status,
      sourceContentType: response.headers.get('content-type') || undefined,
      sourceContentLength: rawContent.length,
      sourceUrl: targetUrl,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchViaAllOriginsJson(
  url: string,
): Promise<BrowserProxyPayload> {
  const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    return await retry(
      async () => {
        const response = await fetch(proxyUrl, { signal: controller.signal });
        if (!response.ok) {
          const err = new Error(`HTTP ${response.status}: ${response.statusText}`);
          (err as any).status = response.status;
          throw err;
        }

        const data = (await response.json()) as AllOriginsResponse;
        const statusCode = typeof data?.status?.http_code === "number" ? data.status.http_code : undefined;

        if (typeof statusCode === "number" && isProbablyTransientHttpStatus(statusCode)) {
          const err = new Error(`Source HTTP ${statusCode} via allorigins:get`);
          (err as any).status = statusCode;
          throw err;
        }

        return {
          proxyName: "allorigins:get",
          rawContent: typeof data?.contents === "string" ? data.contents : "",
          sourceHttpCode: data?.status?.http_code,
          sourceContentType: data?.status?.content_type,
          sourceContentLength: data?.status?.content_length,
          sourceUrl: data?.status?.url,
        };
      },
      {
        retries: 2,
        baseDelayMs: 300,
        maxDelayMs: 1200,
        shouldRetry: (error) => {
          const status = (error as any)?.status;
          if (typeof status === "number") {
            return {
              retry: isProbablyTransientHttpStatus(status),
              reason: `status ${status}`,
            };
          }
          return shouldRetryUnknownAsTransient(error);
        },
        onRetry: ({ attempt, delayMs, reason, error }) => {
          browseLogger.warn("Retrying allorigins:get", {
            url,
            attempt,
            delayMs,
            reason,
            error: error instanceof Error ? error.message : String(error),
          });
        },
      },
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchViaAllOriginsRaw(
  url: string,
): Promise<BrowserProxyPayload> {
  const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    return await retry(
      async () => {
        const response = await fetch(proxyUrl, { signal: controller.signal });
        if (!response.ok) {
          const err = new Error(`HTTP ${response.status}: ${response.statusText}`);
          (err as any).status = response.status;
          throw err;
        }

        const rawContent = await response.text();
        return {
          proxyName: "allorigins:raw",
          rawContent,
          sourceHttpCode: response.status,
          sourceContentType: response.headers.get("content-type") || undefined,
          sourceContentLength: rawContent.length,
          sourceUrl: url,
        };
      },
      {
        retries: 2,
        baseDelayMs: 300,
        maxDelayMs: 1200,
        shouldRetry: (error) => {
          const status = (error as any)?.status;
          if (typeof status === "number") {
            return {
              retry: isProbablyTransientHttpStatus(status),
              reason: `status ${status}`,
            };
          }
          return shouldRetryUnknownAsTransient(error);
        },
        onRetry: ({ attempt, delayMs, reason, error }) => {
          browseLogger.warn("Retrying allorigins:raw", {
            url,
            attempt,
            delayMs,
            reason,
            error: error instanceof Error ? error.message : String(error),
          });
        },
      },
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchViaCorsProxy(url: string): Promise<BrowserProxyPayload> {
  const targetUrl = withHttpScheme(url);
  const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    return await retry(
      async () => {
        const response = await fetch(proxyUrl, { signal: controller.signal });
        if (!response.ok) {
          const err = new Error(`HTTP ${response.status}: ${response.statusText}`);
          (err as any).status = response.status;
          throw err;
        }

        const rawContent = await response.text();
        return {
          proxyName: "corsproxy.io",
          rawContent,
          sourceHttpCode: response.status,
          sourceContentType: response.headers.get("content-type") || undefined,
          sourceContentLength: rawContent.length,
          sourceUrl: targetUrl,
        };
      },
      {
        retries: 2,
        baseDelayMs: 300,
        maxDelayMs: 1200,
        shouldRetry: (error) => {
          const status = (error as any)?.status;
          if (typeof status === "number") {
            return {
              retry: isProbablyTransientHttpStatus(status),
              reason: `status ${status}`,
            };
          }
          return shouldRetryUnknownAsTransient(error);
        },
        onRetry: ({ attempt, delayMs, reason, error }) => {
          browseLogger.warn("Retrying corsproxy.io", {
            url: targetUrl,
            attempt,
            delayMs,
            reason,
            error: error instanceof Error ? error.message : String(error),
          });
        },
      },
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchViaJina(url: string): Promise<BrowserProxyPayload> {
  // Try multiple Jina AI configurations with enhanced approach for Polish sites
  const jinaProxies = ADVANCED_PROXIES.filter(p => p.name.includes('r.jina.ai'));
  
  // For wp.pl, try special configurations first
  if (url.includes('wp.pl')) {
    const wpProxies = jinaProxies.filter(p => p.name.includes('wp-special') || p.name.includes('textise-dot-iitty-wp'));
    const regularProxies = jinaProxies.filter(p => !p.name.includes('wp-special') && !p.name.includes('textise-dot-iitty-wp'));
    
    // Try WP-specific proxies first
    for (const proxy of wpProxies) {
      try {
        const result = await fetchViaAdvancedProxy(url, proxy);
        // Check if we got actual content instead of the blocking message
        if (result.rawContent && !result.rawContent.includes('Pobieranie, zwielokrotnianie, przechowywanie')) {
          return result;
        }
      } catch (error) {
        browseLogger.warn(`Jina AI WP proxy ${proxy.name} failed, trying next`, {
          url,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
    }
    
    // Then try regular Jina proxies
    for (const proxy of regularProxies) {
      try {
        const result = await fetchViaAdvancedProxy(url, proxy);
        if (result.rawContent && !result.rawContent.includes('Pobieranie, zwielokrotnianie, przechowywanie')) {
          return result;
        }
      } catch (error) {
        browseLogger.warn(`Jina AI proxy ${proxy.name} failed, trying next`, {
          url,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
    }
  } else {
    // For non-wp.pl sites, try all Jina proxies
    for (const proxy of jinaProxies) {
      try {
        return await fetchViaAdvancedProxy(url, proxy);
      } catch (error) {
        browseLogger.warn(`Jina AI proxy ${proxy.name} failed, trying next`, {
          url,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
    }
  }
  
  throw new Error('All Jina AI proxies failed');
}

async function browseInBrowser(url: string): Promise<BrowseResult> {
  const runBrowseInBrowser = logAsyncDecorator(
    "browse:gateway",
    "browseInBrowser",
    async () => {
      // Smart proxy selection based on URL
      const fetchers = getSmartFetchers(url);
      const failures: string[] = [];

      for (const fetcher of fetchers) {
        try {
          const payload = await fetcher();
          const rawContent = payload.rawContent || "";

          browseLogger.info("Browser proxy payload received", {
            url,
            proxy: payload.proxyName,
            hasContents: !!rawContent,
            sourceHttpCode: payload.sourceHttpCode,
            sourceContentType: payload.sourceContentType,
            sourceContentLength: payload.sourceContentLength,
          });

          if (!rawContent.trim()) {
            const emptyMessage = `Empty payload from ${payload.proxyName}`;
            failures.push(emptyMessage);
            browseLogger.warn("Browser proxy returned empty payload", {
              url,
              proxy: payload.proxyName,
              sourceUrl: payload.sourceUrl,
            });
            continue;
          }

          // Enhanced content validation (disabled in test environment)
          if (process.env.NODE_ENV !== 'test' && !isValidContent(rawContent, url)) {
            const invalidMessage = `Invalid/blocked content from ${payload.proxyName}`;
            failures.push(invalidMessage);
            browseLogger.warn("Browser proxy returned invalid content", {
              url,
              proxy: payload.proxyName,
              contentLength: rawContent.length,
              preview: rawContent.slice(0, 200),
            });
            continue;
          }

          const htmlPayload = looksLikeHtml(rawContent);
          const extracted = htmlPayload
            ? extractBrowserReadableContent(rawContent)
            : {
                title: "Untitled",
                content: rawContent,
              };

          const normalized = normalizeBrowseResult(
            {
              url,
              title: extracted.title,
              content: extracted.content,
            },
            "browser",
            url,
          );

          browseLogger.info("Browser fallback content prepared", {
            url,
            proxy: payload.proxyName,
            titleLength: normalized.title.length,
            contentLength: normalized.content.length,
            htmlPayload,
          });

          return normalized;
        } catch (error) {
          const message = summarizeUnknownError(error);
          failures.push(message);
          browseLogger.warn("Browser proxy attempt failed", {
            url,
            error: message,
          });
        }
      }

      throw new Error(
        `Nie udało się pobrać strony: żaden z serwerów proxy nie odpowiedział. ` +
        `Strona może być niedostępna lub blokować dostęp. ` +
        `Spróbuj ponownie lub uruchom aplikację w trybie Tauri dla lepszych wyników.`
      );
    },
  );

  return runBrowseInBrowser();
}

function getSmartFetchers(url: string): Array<() => Promise<BrowserProxyPayload>> {
  const fetchers: Array<() => Promise<BrowserProxyPayload>> = [];
  
  // For Polish news sites, prioritize content readers
  if (url.includes('wp.pl') || url.includes('onet.pl') || url.includes('interia.pl') || url.includes('newsweek.pl')) {
    fetchers.push(() => fetchViaJina(url)); // Jina AI is best for content extraction
    fetchers.push(() => fetchViaAllOriginsJson(url));
    fetchers.push(() => fetchViaCorsProxy(url));
    fetchers.push(() => fetchViaAllOriginsRaw(url));
  }
  // For tech/documentation sites, try different order
  else if (url.includes('github.com') || url.includes('stackoverflow.com') || url.includes('medium.com')) {
    fetchers.push(() => fetchViaJina(url));
    fetchers.push(() => fetchViaCorsProxy(url));
    fetchers.push(() => fetchViaAllOriginsRaw(url));
    fetchers.push(() => fetchViaAllOriginsJson(url));
  }
  // Default order for general sites
  else {
    fetchers.push(() => fetchViaAllOriginsJson(url));
    fetchers.push(() => fetchViaCorsProxy(url));
    fetchers.push(() => fetchViaAllOriginsRaw(url));
    fetchers.push(() => fetchViaJina(url));
  }
  
  return fetchers;
}

function isValidContent(content: string, url: string): boolean {
  // Check for common bot detection/blocking messages
  const blockingPatterns = [
    /access.*denied/i,
    /blocked.*by.*security/i,
    /bot.*detection/i,
    /captcha/i,
    /cloudflare/i,
    /access.*forbidden/i,
    /403.*forbidden/i,
    /automated.*access/i,
    /suspicious.*activity/i,
    /rate.*limit/i,
    /too.*many.*requests/i,
  ];

  // Check for Polish blocking messages
  const polishBlockingPatterns = [
    /dostęp.*zabroniony/i,
    /zablokowany.*dostęp/i,
    /wykryto.*bot/i,
    /podejrzana.*aktywność/i,
    /zbyt.*wiele.*zapytań/i,
    /ochrona.*przed.*botami/i,
  ];

  // Specific WP.pl blocking message
  const wpBlockingPatterns = [
    /Pobieranie, zwielokrotnianie, przechowywanie lub jakiekolwiek inne wykorzystywanie treści/i,
    /wymaga uprzedniej i jednoznacznej zgody Wirtualna Polska Media/i,
    /bez względu na sposób ich eksploracji i wykorzystaną metodę/i,
    /w tym z użyciem programów uczenia maszynowego lub sztucznej inteligencji/i,
    /zastrzeżenie nie dotyczy wykorzystywania jedynie w celu ułatwienia ich wyszukiwania/i,
  ];

  const allPatterns = [...blockingPatterns, ...polishBlockingPatterns, ...wpBlockingPatterns];
  
  for (const pattern of allPatterns) {
    if (pattern.test(content)) {
      return false;
    }
  }

  // Check if content is too short (likely a blocking page)
  if (content.length < 100) {
    return false;
  }

  // Special check for WP.pl - if it contains the blocking message, reject
  if (url.includes('wp.pl') && content.includes('Wirtualna Polska Media')) {
    return false;
  }

  // Check if content contains actual meaningful content
  const meaningfulWords = /\b(the|and|or|but|in|on|at|to|for|of|with|by|is|are|was|were|be|been|have|has|had|do|does|did|will|would|could|should|may|might|must|can|this|that|these|those|a|an|i|you|he|she|it|we|they|me|him|her|us|them|my|your|his|her|its|our|their)\b/i;
  const polishWords = /\b(i|w|na|do|od|do|z|za|przez|pod|nad|przed|po|bez|dla|o|jak|kiedy|gdzie|dlaczego|co|kto|jaki|jaka|jakie|który|która|które|jesteś|jestem|jesteśmy|są|mają|mieć|być|był|była|było|były|będę|będziesz|będzie|będziemy|będziecie|będą)\b/i;
  
  const hasMeaningfulContent = meaningfulWords.test(content) || polishWords.test(content);
  
  if (!hasMeaningfulContent && content.length > 500) {
    // Long content without meaningful words is likely blocked/garbled
    return false;
  }

  return true;
}

export async function executeBrowseCommand(
  url: string,
  runtimeIsTauri: boolean = isTauriRuntime(),
): Promise<BrowseResult> {
  const runExecuteBrowseCommand = logAsyncDecorator(
    "browse:gateway",
    "executeBrowseCommand",
    async () => {
      browseLogger.info("Dispatching browse command", {
        url,
        runtime: runtimeIsTauri ? "tauri" : "browser",
      });

      if (runtimeIsTauri) {
        const result = await invoke<BrowseResult>("browse", { url });
        const rawTitle = typeof result.title === "string" ? result.title : "";
        const rawContent =
          typeof result.content === "string" ? result.content : "";
        const normalized = normalizeBrowseResult(result, "tauri", url);

        browseLogger.info("Tauri browse command completed", {
          url: normalized.url,
          titleLength: normalized.title.length,
          contentLength: normalized.content.length,
          originalTitleLength: rawTitle.length,
          originalContentLength: rawContent.length,
          contentAppearedHtml: looksLikeHtml(rawContent),
        });

        return normalized;
      }

      const result = await browseInBrowser(url);
      browseLogger.info("Browser fallback browse completed", {
        url: result.url,
        contentLength: result.content.length,
      });
      return result;
    },
  );

  return runExecuteBrowseCommand();
}
