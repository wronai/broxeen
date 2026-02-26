import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { Chat } from '../Chat';
import { CqrsProvider } from '../core/cqrsProvider';
import { PluginProvider } from '../core/pluginContext';
import { EventStoreProvider } from '../core/eventStoreProvider';
import { ConfigStoreProvider } from '../config/configStore';
import { DatabaseManagerProvider } from '../hooks/useDatabaseManager';
import { resetSystemContext } from '../core/systemContext';

// Mock Tauri API
const mockTauriInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockTauriInvoke,
}));

describe('File Search E2E Tests', () => {
  beforeEach(() => {
    process.env.HOME = '/home/test';
    resetSystemContext();
    mockTauriInvoke.mockClear();
  });

  afterEach(() => {
    resetSystemContext();
  });

  const renderChatWithProviders = () => {
    return render(
      <ConfigStoreProvider>
        <DatabaseManagerProvider>
          <EventStoreProvider>
            <CqrsProvider>
              <PluginProvider>
                <Chat />
              </PluginProvider>
            </CqrsProvider>
          </EventStoreProvider>
        </DatabaseManagerProvider>
      </ConfigStoreProvider>
    );
  };

  it('performs basic file search and displays results', async () => {
    // Mock file search response
    mockTauriInvoke.mockImplementation(async (command: string, args?: any) => {
      if (command === 'file_search') {
        return {
          results: [
            {
              path: '/home/test/test.txt',
              name: 'test.txt',
              extension: 'txt',
              size_bytes: 1024,
              modified: '2024-01-01 12:00:00',
              file_type: 'plik tekstowy',
              is_dir: false,
              preview: 'This is a test file...',
              mime_type: 'text/plain',
            },
            {
              path: '/home/test/document.pdf',
              name: 'document.pdf',
              extension: 'pdf',
              size_bytes: 2048,
              modified: '2024-01-02 15:30:00',
              file_type: 'dokument PDF',
              is_dir: false,
              preview: null,
              mime_type: 'application/pdf',
            },
          ],
          total_found: 2,
          search_path: '/home/test',
          query: 'test',
          duration_ms: 150,
          truncated: false,
        };
      }
      return {};
    });

    renderChatWithProviders();

    // Find the chat input
    const chatInput = screen.getByRole('textbox');
    expect(chatInput).toBeInTheDocument();

    // Type file search command
    fireEvent.change(chatInput, { target: { value: 'szukaj plików test' } });
    fireEvent.keyDown(chatInput, { key: 'Enter' });

    // Wait for the response
    await waitFor(() => {
      expect(screen.getByText(/znaleziono.*plików/i)).toBeInTheDocument();
    });

    // Verify search results are displayed
    expect(screen.getByText('test.txt')).toBeInTheDocument();
    expect(screen.getByText('document.pdf')).toBeInTheDocument();
    expect(screen.getByText('plik tekstowy')).toBeInTheDocument();
    expect(screen.getByText('dokument PDF')).toBeInTheDocument();
    expect(screen.getByText('This is a test file...')).toBeInTheDocument();

    // Verify search metadata
    expect(screen.getByText(/150ms/)).toBeInTheDocument();
    expect(screen.getByText('/home/test')).toBeInTheDocument();
  });

  it('handles file search with extension filters', async () => {
    mockTauriInvoke.mockImplementation(async (command: string, args?: any) => {
      if (command === 'file_search') {
        return {
          results: [
            {
              path: '/home/test/script.rs',
              name: 'script.rs',
              extension: 'rs',
              size_bytes: 512,
              modified: '2024-01-01 10:00:00',
              file_type: 'kod Rust',
              is_dir: false,
              preview: 'fn main() { println!("Hello"); }',
              mime_type: 'text/x-source',
            },
          ],
          total_found: 1,
          search_path: '/home/test',
          query: '',
          duration_ms: 75,
          truncated: false,
        };
      }
      return {};
    });

    renderChatWithProviders();

    const chatInput = screen.getByRole('textbox');
    fireEvent.change(chatInput, { target: { value: 'szukaj plików rs' } });
    fireEvent.keyDown(chatInput, { key: 'Enter' });

    await waitFor(() => {
      expect(screen.getByText('script.rs')).toBeInTheDocument();
    });

    expect(screen.getByText('kod Rust')).toBeInTheDocument();
    expect(screen.getByText('fn main() { println!("Hello"); }')).toBeInTheDocument();
  });

  it('displays file content when requested', async () => {
    // Mock file search first
    mockTauriInvoke.mockImplementation(async (command: string, args?: any) => {
      if (command === 'file_search') {
        return {
          results: [
            {
              path: '/home/test/readme.txt',
              name: 'readme.txt',
              extension: 'txt',
              size_bytes: 256,
              modified: '2024-01-01 09:00:00',
              file_type: 'plik tekstowy',
              is_dir: false,
              preview: 'Project documentation...',
              mime_type: 'text/plain',
            },
          ],
          total_found: 1,
          search_path: '/home/test',
          query: 'readme',
          duration_ms: 50,
          truncated: false,
        };
      }
      if (command === 'file_read_content') {
        return {
          path: '/home/test/readme.txt',
          name: 'readme.txt',
          content: '# Project README\n\nThis is the main documentation for the project.\n\n## Installation\n\n```bash\nnpm install\n```\n\n## Usage\n\nRun the application with:\n\n```bash\nnpm start\n```',
          size_bytes: 256,
          mime_type: 'text/plain',
          truncated: false,
        };
      }
      return {};
    });

    renderChatWithProviders();

    const chatInput = screen.getByRole('textbox');
    
    // First search for the file
    fireEvent.change(chatInput, { target: { value: 'szukaj readme' } });
    fireEvent.keyDown(chatInput, { key: 'Enter' });

    await waitFor(() => {
      expect(screen.getByText('readme.txt')).toBeInTheDocument();
    });

    // Then request to read the content
    fireEvent.change(chatInput, { target: { value: 'pokaż zawartość readme.txt' } });
    fireEvent.keyDown(chatInput, { key: 'Enter' });

    await waitFor(() => {
      expect(screen.getByText('# Project README')).toBeInTheDocument();
    });

    expect(screen.getByText('This is the main documentation for the project.')).toBeInTheDocument();
    expect(screen.getByText('## Installation')).toBeInTheDocument();
    expect(screen.getByText('```bash\nnpm install\n```')).toBeInTheDocument();
  });

  it('handles search errors gracefully', async () => {
    mockTauriInvoke.mockImplementation(async (command: string, args?: any) => {
      if (command === 'file_search') {
        throw new Error('Ścieżka nie istnieje: /nonexistent/path');
      }
      return {};
    });

    renderChatWithProviders();

    const chatInput = screen.getByRole('textbox');
    fireEvent.change(chatInput, { target: { value: 'szukaj w /nonexistent/path' } });
    fireEvent.keyDown(chatInput, { key: 'Enter' });

    await waitFor(() => {
      expect(screen.getByText(/nie istnieje/i)).toBeInTheDocument();
    });
  });

  it('displays image files with base64 encoding', async () => {
    mockTauriInvoke.mockImplementation(async (command: string, args?: any) => {
      if (command === 'file_search') {
        return {
          results: [
            {
              path: '/home/test/image.png',
              name: 'image.png',
              extension: 'png',
              size_bytes: 1024,
              modified: '2024-01-01 14:00:00',
              file_type: 'obraz',
              is_dir: false,
              preview: null,
              mime_type: 'image/png',
            },
          ],
          total_found: 1,
          search_path: '/home/test',
          query: 'image',
          duration_ms: 100,
          truncated: false,
        };
      }
      if (command === 'file_read_content') {
        return {
          path: '/home/test/image.png',
          name: 'image.png',
          content: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
          size_bytes: 1024,
          mime_type: 'image/png',
          truncated: false,
        };
      }
      return {};
    });

    renderChatWithProviders();

    const chatInput = screen.getByRole('textbox');
    fireEvent.change(chatInput, { target: { value: 'szukaj obrazów' } });
    fireEvent.keyDown(chatInput, { key: 'Enter' });

    await waitFor(() => {
      expect(screen.getByText('image.png')).toBeInTheDocument();
    });

    expect(screen.getByText('obraz')).toBeInTheDocument();

    // Request to view the image
    fireEvent.change(chatInput, { target: { value: 'pokaż image.png' } });
    fireEvent.keyDown(chatInput, { key: 'Enter' });

    await waitFor(() => {
      const image = screen.getByRole('img') as HTMLImageElement;
      expect(image).toBeInTheDocument();
      expect(image.src).toContain('data:image/png;base64,');
    });
  });

  it('shows performance improvements with rust_search', async () => {
    const performanceData = [
      { query: 'large search', duration_ms: 150, files_found: 1000 },
      { query: 'filtered search', duration_ms: 75, files_found: 250 },
      { query: 'deep search', duration_ms: 200, files_found: 500 },
    ];

    let callCount = 0;
    mockTauriInvoke.mockImplementation(async (command: string, args?: any) => {
      if (command === 'file_search') {
        const data = performanceData[callCount % performanceData.length];
        callCount++;
        return {
          results: Array.from({ length: Math.min(data.files_found, 50) }, (_, i) => ({
            path: `/home/test/file_${i}.txt`,
            name: `file_${i}.txt`,
            extension: 'txt',
            size_bytes: 1024,
            modified: '2024-01-01 12:00:00',
            file_type: 'plik tekstowy',
            is_dir: false,
            preview: `Content of file ${i}...`,
            mime_type: 'text/plain',
          })),
          total_found: data.files_found,
          search_path: '/home/test',
          query: data.query,
          duration_ms: data.duration_ms,
          truncated: data.files_found > 50,
        };
      }
      return {};
    });

    renderChatWithProviders();

    const chatInput = screen.getByRole('textbox');

    // Perform multiple searches to test performance
    for (const expectedData of performanceData) {
      fireEvent.change(chatInput, { target: { value: expectedData.query } });
      fireEvent.keyDown(chatInput, { key: 'Enter' });

      await waitFor(() => {
        expect(screen.getByText(new RegExp(`${expectedData.duration_ms}ms`))).toBeInTheDocument();
      });

      expect(screen.getByText(new RegExp(`${expectedData.files_found}.*plików`, 'i'))).toBeInTheDocument();
      
      if (expectedData.files_found > 50) {
        expect(screen.getByText(/wyników.*ograniczono/i)).toBeInTheDocument();
      }
    }
  });
});
