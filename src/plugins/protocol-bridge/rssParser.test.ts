import { describe, it, expect, beforeEach, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';

// Mock the Tauri invoke function
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('RSS Parser Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should parse RSS feed correctly', async () => {
    const mockRssContent = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test RSS Feed</title>
    <description>This is a test RSS feed</description>
    <link>https://example.com</link>
    <item>
      <title>First Article</title>
      <description>This is the first article description</description>
      <link>https://example.com/article1</link>
      <pubDate>Mon, 24 Feb 2026 12:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Second Article</title>
      <description>This is the second article description</description>
      <link>https://example.com/article2</link>
      <pubDate>Mon, 24 Feb 2026 11:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

    // Mock browse command to return RSS content
    vi.mocked(invoke).mockResolvedValueOnce({
      title: 'Test RSS Feed',
      content: mockRssContent,
      url: 'https://example.com/feed.xml'
    });

    // Mock RSS parser command
    vi.mocked(invoke).mockResolvedValueOnce(
      `📰 **Test RSS Feed**

This is a test RSS feed

🔗 https://example.com

**1. First Article**
🔗 https://example.com/article1
📅 Mon, 24 Feb 2026 12:00:00 GMT
This is the first article description

**2. Second Article**
🔗 https://example.com/article2
📅 Mon, 24 Feb 2026 11:00:00 GMT
This is the second article description`
    );

    const { ProtocolBridgePlugin } = await import('./protocolBridgePlugin');
    const plugin = new ProtocolBridgePlugin();
    const mockContext = {
      isTauri: true,
      tauriInvoke: invoke,
    };

    const result = await plugin.execute('bridge rss https://example.com/feed.xml', mockContext);

    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('📰 **Test RSS Feed**');
    expect(result.content[0].data).toContain('First Article');
    expect(result.content[0].data).toContain('Second Article');
    expect(invoke).toHaveBeenCalledWith('browse', { url: 'https://example.com/feed.xml' });
    expect(invoke).toHaveBeenCalledWith('parse_rss_feed_command', {
      url: 'https://example.com/feed.xml',
      content: mockRssContent,
      maxItems: 10
    });
  });

  it('should parse Atom feed correctly', async () => {
    const mockAtomContent = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Test Atom Feed</title>
  <subtitle>This is a test Atom feed</subtitle>
  <link href="https://example.com"/>
  <updated>2026-02-24T12:00:00Z</updated>
  <entry>
    <title>First Entry</title>
    <summary>This is the first entry summary</summary>
    <link href="https://example.com/entry1"/>
    <published>2026-02-24T12:00:00Z</published>
  </entry>
  <entry>
    <title>Second Entry</title>
    <summary>This is the second entry summary</summary>
    <link href="https://example.com/entry2"/>
    <published>2026-02-24T11:00:00Z</published>
  </entry>
</feed>`;

    // Mock browse command to return Atom content
    vi.mocked(invoke).mockResolvedValueOnce({
      title: 'Test Atom Feed',
      content: mockAtomContent,
      url: 'https://example.com/atom.xml'
    });

    // Mock RSS parser command
    vi.mocked(invoke).mockResolvedValueOnce(
      `🗞️ **Test Atom Feed**

This is a test Atom feed

🔗 https://example.com

**1. First Entry**
🔗 https://example.com/entry1
📅 2026-02-24T12:00:00Z
This is the first entry summary

**2. Second Entry**
🔗 https://example.com/entry2
📅 2026-02-24T11:00:00Z
This is the second entry summary`
    );

    const { ProtocolBridgePlugin } = await import('./protocolBridgePlugin');
    const plugin = new ProtocolBridgePlugin();
    const mockContext = {
      isTauri: true,
      tauriInvoke: invoke,
    };

    const result = await plugin.execute('bridge atom https://example.com/atom.xml', mockContext);

    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('🗞️ **Test Atom Feed**');
    expect(result.content[0].data).toContain('First Entry');
    expect(result.content[0].data).toContain('Second Entry');
    expect(invoke).toHaveBeenCalledWith('browse', { url: 'https://example.com/atom.xml' });
    expect(invoke).toHaveBeenCalledWith('parse_rss_feed_command', {
      url: 'https://example.com/atom.xml',
      content: mockAtomContent,
      maxItems: 10
    });
  });

  it('should fall back to regular browse when RSS parsing fails', async () => {
    const mockHtmlContent = '<html><head><title>Regular Page</title></head><body><p>This is not RSS</p></body></html>';

    // Mock browse command to return HTML content
    vi.mocked(invoke).mockResolvedValueOnce({
      title: 'Regular Page',
      content: mockHtmlContent,
      url: 'https://example.com/not-rss'
    });

    // Mock RSS parser command to fail
    vi.mocked(invoke).mockRejectedValueOnce(new Error('Not an RSS feed'));

    const { ProtocolBridgePlugin } = await import('./protocolBridgePlugin');
    const plugin = new ProtocolBridgePlugin();
    const mockContext = {
      isTauri: true,
      tauriInvoke: invoke,
    };

    const result = await plugin.execute('bridge rss https://example.com/not-rss', mockContext);

    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('📰 **RSS Feed**');
    expect(result.content[0].data).toContain('Regular Page');
    expect(invoke).toHaveBeenCalledWith('browse', { url: 'https://example.com/not-rss' });
    expect(invoke).toHaveBeenCalledWith('parse_rss_feed_command', {
      url: 'https://example.com/not-rss',
      content: mockHtmlContent,
      maxItems: 10
    });
  });

  it('should handle browser fallback correctly', async () => {
    const { ProtocolBridgePlugin } = await import('./protocolBridgePlugin');
    const plugin = new ProtocolBridgePlugin();
    const mockContext = {
      isTauri: false, // Browser context
    };

    // Mock executeBrowseCommand for browser fallback
    const mockBrowseResult = {
      title: 'Browser RSS',
      content: 'Browser content',
      url: 'https://example.com/feed.xml'
    };

    vi.doMock('../../lib/browseGateway', () => ({
      executeBrowseCommand: vi.fn().mockResolvedValue(mockBrowseResult)
    }));

    const result = await plugin.execute('bridge rss https://example.com/feed.xml', mockContext);

    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('📰 **RSS Feed**');
    expect(result.content[0].data).toContain('Browser content');
  });
});
