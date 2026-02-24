import React from 'react';
import { 
  Rss, 
  Mail, 
  Phone, 
  Map, 
  BookOpen, 
  Linkedin, 
  Facebook, 
  Twitter, 
  Github, 
  Youtube, 
  Instagram 
} from 'lucide-react';
import type { ChatMessage } from '../domain/chatEvents';

interface QuickActionButtonsProps {
  message: ChatMessage;
  onActionClick?: (action: string, url: string) => void;
}

interface ActionLink {
  type: 'rss' | 'contact' | 'phone' | 'sitemap' | 'blog' | 'linkedin' | 'facebook' | 'twitter' | 'github' | 'youtube' | 'instagram';
  url: string;
  label: string;
  icon: React.ReactNode;
  color: string;
}

export function QuickActionButtons({ message, onActionClick }: QuickActionButtonsProps) {
  // Extract action links from message
  const actionLinks: ActionLink[] = [];

  if (message.rssUrl) {
    actionLinks.push({
      type: 'rss',
      url: message.rssUrl,
      label: 'RSS Feed',
      icon: <Rss className="w-4 h-4" />,
      color: 'bg-orange-500 hover:bg-orange-600'
    });
  }

  if (message.contactUrl) {
    const isEmail = message.contactUrl.startsWith('mailto:');
    actionLinks.push({
      type: 'contact',
      url: message.contactUrl,
      label: isEmail ? 'Email' : 'Kontakt',
      icon: <Mail className="w-4 h-4" />,
      color: 'bg-blue-500 hover:bg-blue-600'
    });
  }

  if (message.phoneUrl) {
    actionLinks.push({
      type: 'phone',
      url: message.phoneUrl,
      label: 'Telefon',
      icon: <Phone className="w-4 h-4" />,
      color: 'bg-green-500 hover:bg-green-600'
    });
  }

  if (message.sitemapUrl) {
    actionLinks.push({
      type: 'sitemap',
      url: message.sitemapUrl,
      label: 'Sitemap',
      icon: <Map className="w-4 h-4" />,
      color: 'bg-purple-500 hover:bg-purple-600'
    });
  }

  if (message.blogUrl) {
    actionLinks.push({
      type: 'blog',
      url: message.blogUrl,
      label: 'Blog',
      icon: <BookOpen className="w-4 h-4" />,
      color: 'bg-indigo-500 hover:bg-indigo-600'
    });
  }

  if (message.linkedinUrl) {
    actionLinks.push({
      type: 'linkedin',
      url: message.linkedinUrl,
      label: 'LinkedIn',
      icon: <Linkedin className="w-4 h-4" />,
      color: 'bg-blue-700 hover:bg-blue-800'
    });
  }

  if (message.facebookUrl) {
    actionLinks.push({
      type: 'facebook',
      url: message.facebookUrl,
      label: 'Facebook',
      icon: <Facebook className="w-4 h-4" />,
      color: 'bg-blue-600 hover:bg-blue-700'
    });
  }

  if (message.twitterUrl) {
    actionLinks.push({
      type: 'twitter',
      url: message.twitterUrl,
      label: 'X/Twitter',
      icon: <Twitter className="w-4 h-4" />,
      color: 'bg-sky-500 hover:bg-sky-600'
    });
  }

  if (message.githubUrl) {
    actionLinks.push({
      type: 'github',
      url: message.githubUrl,
      label: 'GitHub',
      icon: <Github className="w-4 h-4" />,
      color: 'bg-gray-800 hover:bg-gray-900'
    });
  }

  if (message.youtubeUrl) {
    actionLinks.push({
      type: 'youtube',
      url: message.youtubeUrl,
      label: 'YouTube',
      icon: <Youtube className="w-4 h-4" />,
      color: 'bg-red-600 hover:bg-red-700'
    });
  }

  if (message.instagramUrl) {
    actionLinks.push({
      type: 'instagram',
      url: message.instagramUrl,
      label: 'Instagram',
      icon: <Instagram className="w-4 h-4" />,
      color: 'bg-pink-600 hover:bg-pink-700'
    });
  }

  // Don't render if no action links
  if (actionLinks.length === 0) {
    return null;
  }

  const handleActionClick = (action: ActionLink) => {
    if (onActionClick) {
      onActionClick(action.type, action.url);
    } else {
      // Default behavior: open in new tab
      if (action.type === 'contact' && action.url.startsWith('mailto:')) {
        window.location.href = action.url;
      } else if (action.type === 'phone' && action.url.startsWith('tel:')) {
        window.location.href = action.url;
      } else {
        window.open(action.url, '_blank');
      }
    }
  };

  return (
    <div className="mt-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
      <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
        🚀 Szybkie akcje:
      </div>
      <div className="flex flex-wrap gap-2">
        {actionLinks.map((action, index) => (
          <button
            key={index}
            onClick={() => handleActionClick(action)}
            className={`
              inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-white text-xs font-medium
              transition-colors duration-200 shadow-sm hover:shadow-md
              ${action.color}
            `}
            title={`${action.label}: ${action.url}`}
          >
            {action.icon}
            <span>{action.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// Helper component to render quick actions within message content
export function MessageWithQuickActions({ 
  message, 
  onActionClick 
}: { 
  message: ChatMessage; 
  onActionClick?: (action: string, url: string) => void;
}) {
  const hasQuickActions = Boolean(
    message.rssUrl || 
    message.contactUrl || 
    message.phoneUrl || 
    message.sitemapUrl || 
    message.blogUrl || 
    message.linkedinUrl || 
    message.facebookUrl || 
    message.twitterUrl || 
    message.githubUrl || 
    message.youtubeUrl || 
    message.instagramUrl
  );

  return (
    <div className="space-y-3">
      <div className="prose prose-sm dark:prose-invert max-w-none">
        {message.text}
      </div>
      {hasQuickActions && (
        <QuickActionButtons message={message} onActionClick={onActionClick} />
      )}
    </div>
  );
}
