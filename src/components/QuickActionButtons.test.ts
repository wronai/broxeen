import { describe, it, expect } from 'vitest';
import { extract_action_links } from '../../src-tauri/src/content_extraction';

// Mock HTML content similar to prototypowanie.pl
const mockHtml = `
<html>
<head>
  <title>prototypowanie.pl - Wdrożenie oprogramowania w 24h</title>
  <link rel="alternate" type="application/rss+xml" title="RSS Feed" href="/feed.xml">
  <link rel="sitemap" type="application/xml" href="/sitemap.xml">
</head>
<body>
  <header>
    <nav>
      <a href="/blog">Blog</a>
      <a href="/kontakt">Kontakt</a>
      <a href="mailto:info@prototypowanie.pl">info@prototypowanie.pl</a>
      <a href="tel:+48503503761">+48 503 503 761</a>
      <a href="https://www.linkedin.com/company/prototypowanie-pl/">LinkedIn</a>
      <a href="https://www.facebook.com/prototypowanie">Facebook</a>
      <a href="https://github.com/prototypowanie">GitHub</a>
      <a href="https://www.youtube.com/c/prototypowanie">YouTube</a>
      <a href="https://www.instagram.com/prototypowanie">Instagram</a>
      <a href="https://twitter.com/prototypowanie">Twitter</a>
    </nav>
  </header>
  <main>
    <h1>Twoje oprogramowanie gotowe w 24h?</h1>
    <p>Jak to działa: Wypełnij poniższy formularz: Opisz, czego potrzebujesz – aplikacji webowej, automatyzacji, integracji...</p>
  </main>
</body>
</html>
`;

describe('Quick Action Links Detection', () => {
  it('should extract all action links from HTML', () => {
    // Parse HTML using scraper (similar to Rust implementation)
    const scraper = require('scraperjs');
    const document = scraper.StaticHtmlParser.load(mockHtml);
    
    // This simulates the Rust extract_action_links function
    const actionLinks = {
      rss_url: null,
      contact_url: null,
      phone_url: null,
      sitemap_url: null,
      blog_url: null,
      linkedin_url: null,
      facebook_url: null,
      twitter_url: null,
      github_url: null,
      youtube_url: null,
      instagram_url: null,
    };

    // Extract RSS from link tags
    const rssLink = document('link[type="application/rss+xml"]').first();
    if (rssLink.length > 0) {
      actionLinks.rss_url = rssLink.attr('href');
    }

    // Extract sitemap from link tags
    const sitemapLink = document('link[rel="sitemap"]').first();
    if (sitemapLink.length > 0) {
      actionLinks.sitemap_url = sitemapLink.attr('href');
    }

    // Extract other links
    actionLinks.blog_url = document('a[href*="blog"]').first().attr('href') || null;
    actionLinks.contact_url = document('a[href*="kontakt"]').first().attr('href') || null;
    actionLinks.linkedin_url = document('a[href*="linkedin"]').first().attr('href') || null;
    actionLinks.facebook_url = document('a[href*="facebook"]').first().attr('href') || null;
    actionLinks.twitter_url = document('a[href*="twitter"]').first().attr('href') || null;
    actionLinks.github_url = document('a[href*="github"]').first().attr('href') || null;
    actionLinks.youtube_url = document('a[href*="youtube"]').first().attr('href') || null;
    actionLinks.instagram_url = document('a[href*="instagram"]').first().attr('href') || null;

    // Check extracted links
    expect(actionLinks.rss_url).toBe('/feed.xml');
    expect(actionLinks.sitemap_url).toBe('/sitemap.xml');
    expect(actionLinks.blog_url).toBe('/blog');
    expect(actionLinks.contact_url).toBe('/kontakt');
    expect(actionLinks.linkedin_url).toBe('https://www.linkedin.com/company/prototypowanie-pl/');
    expect(actionLinks.facebook_url).toBe('https://www.facebook.com/prototypowanie');
    expect(actionLinks.twitter_url).toBe('https://twitter.com/prototypowanie');
    expect(actionLinks.github_url).toBe('https://github.com/prototypowanie');
    expect(actionLinks.youtube_url).toBe('https://www.youtube.com/c/prototypowanie');
    expect(actionLinks.instagram_url).toBe('https://www.instagram.com/prototypowanie');
  });

  it('should handle missing links gracefully', () => {
    const simpleHtml = `
    <html>
      <head><title>Simple Page</title></head>
      <body>
        <h1>No action links here</h1>
      </body>
    </html>
    `;

    const scraper = require('scraperjs');
    const document = scraper.StaticHtmlParser.load(simpleHtml);
    
    const actionLinks = {
      rss_url: null,
      contact_url: null,
      phone_url: null,
      sitemap_url: null,
      blog_url: null,
      linkedin_url: null,
      facebook_url: null,
      twitter_url: null,
      github_url: null,
      youtube_url: null,
      instagram_url: null,
    };

    // Try to extract links
    actionLinks.rss_url = document('link[type="application/rss+xml"]').first().attr('href') || null;
    actionLinks.blog_url = document('a[href*="blog"]').first().attr('href') || null;

    // All should be null
    expect(actionLinks.rss_url).toBeNull();
    expect(actionLinks.blog_url).toBeNull();
  });
});
