import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QuickActionButtons } from './QuickActionButtons';
import type { ChatMessage } from '../domain/chatEvents';

describe('QuickActionButtons', () => {
  const mockMessage: ChatMessage = {
    id: 'test-1',
    role: 'assistant',
    text: 'Test message with action links',
    timestamp: Date.now(),
    rssUrl: 'https://example.com/feed.xml',
    contactUrl: 'mailto:test@example.com',
    phoneUrl: 'tel:+123456789',
    sitemapUrl: 'https://example.com/sitemap.xml',
    blogUrl: 'https://example.com/blog',
    linkedinUrl: 'https://linkedin.com/company/example',
    facebookUrl: 'https://facebook.com/example',
    twitterUrl: 'https://twitter.com/example',
    githubUrl: 'https://github.com/example',
    youtubeUrl: 'https://youtube.com/example',
    instagramUrl: 'https://instagram.com/example',
  };

  it('should render all available action buttons', () => {
    render(<QuickActionButtons message={mockMessage} />);
    
    // Check if all action buttons are rendered
    expect(screen.getByText('RSS Feed')).toBeInTheDocument();
    expect(screen.getByText('Email')).toBeInTheDocument();
    expect(screen.getByText('Telefon')).toBeInTheDocument();
    expect(screen.getByText('Sitemap')).toBeInTheDocument();
    expect(screen.getByText('Blog')).toBeInTheDocument();
    expect(screen.getByText('LinkedIn')).toBeInTheDocument();
    expect(screen.getByText('Facebook')).toBeInTheDocument();
    expect(screen.getByText('X/Twitter')).toBeInTheDocument();
    expect(screen.getByText('GitHub')).toBeInTheDocument();
    expect(screen.getByText('YouTube')).toBeInTheDocument();
    expect(screen.getByText('Instagram')).toBeInTheDocument();
  });

  it('should not render when no action links are available', () => {
    const emptyMessage: ChatMessage = {
      id: 'test-2',
      role: 'assistant',
      text: 'Test message without action links',
      timestamp: Date.now(),
    };

    const { container } = render(<QuickActionButtons message={emptyMessage} />);
    
    // Component should return null (no content)
    expect(container.firstChild).toBeNull();
  });

  it('should render only available action buttons', () => {
    const partialMessage: ChatMessage = {
      id: 'test-3',
      role: 'assistant',
      text: 'Test message with partial action links',
      timestamp: Date.now(),
      rssUrl: 'https://example.com/feed.xml',
      contactUrl: 'mailto:test@example.com',
      // Other links are undefined
    };

    render(<QuickActionButtons message={partialMessage} />);
    
    // Only RSS and Email should be rendered
    expect(screen.getByText('RSS Feed')).toBeInTheDocument();
    expect(screen.getByText('Email')).toBeInTheDocument();
    
    // Other buttons should not be present
    expect(screen.queryByText('Telefon')).not.toBeInTheDocument();
    expect(screen.queryByText('Sitemap')).not.toBeInTheDocument();
    expect(screen.queryByText('Blog')).not.toBeInTheDocument();
  });

  it('should handle email and phone links correctly', () => {
    const emailPhoneMessage: ChatMessage = {
      id: 'test-4',
      role: 'assistant',
      text: 'Test message with email and phone',
      timestamp: Date.now(),
      contactUrl: 'mailto:info@prototypowanie.pl',
      phoneUrl: 'tel:+48503503761',
    };

    render(<QuickActionButtons message={emailPhoneMessage} />);
    
    const emailButton = screen.getByText('Email');
    const phoneButton = screen.getByText('Telefon');
    
    expect(emailButton).toBeInTheDocument();
    expect(phoneButton).toBeInTheDocument();
    
    // Check if they have correct titles/tooltips
    expect(emailButton.closest('button')).toHaveAttribute('title', 'Email: mailto:info@prototypowanie.pl');
    expect(phoneButton.closest('button')).toHaveAttribute('title', 'Telefon: tel:+48503503761');
  });

  it('should handle contact page links correctly', () => {
    const contactPageMessage: ChatMessage = {
      id: 'test-5',
      role: 'assistant',
      text: 'Test message with contact page link',
      timestamp: Date.now(),
      contactUrl: '/kontakt', // Not a mailto link
    };

    render(<QuickActionButtons message={contactPageMessage} />);
    
    const contactButton = screen.getByText('Kontakt'); // Should show "Kontakt" instead of "Email"
    expect(contactButton).toBeInTheDocument();
    expect(contactButton.closest('button')).toHaveAttribute('title', 'Kontakt: /kontakt');
  });
});
