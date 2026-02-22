/**
 * Advanced camera detection with vendor identification and authentication methods
 */

export interface CameraVendor {
  name: string;
  patterns: {
    http?: RegExp[];
    rtsp?: RegExp[];
    onvif?: RegExp[];
    headers?: Record<string, RegExp>;
  };
  ports: {
    http: number[];
    rtsp: number[];
    onvif: number[];
    admin: number[];
  };
  defaultCredentials: Array<{
    username: string;
    password: string;
    description: string;
  }>;
  authMethods: string[];
  features: string[];
}

export const CAMERA_VENDORS: Record<string, CameraVendor> = {
  hikvision: {
    name: 'Hikvision',
    patterns: {
      http: [/hikvision/i, /ivms/i, /iVMS/],
      headers: {
        'Server': /Hikvision/i,
        'X-Frame-Options': /SAMEORIGIN/,
      },
    },
    ports: {
      http: [80, 8000, 8080],
      rtsp: [554, 8554],
      onvif: [80, 8080],
      admin: [8000],
    },
    defaultCredentials: [
      { username: 'admin', password: '12345', description: 'Domyślne (stare modele)' },
      { username: 'admin', password: 'admin', description: 'Alternatywne' },
      { username: 'admin', password: '', description: 'Puste hasło' },
    ],
    authMethods: ['Basic Auth', 'Digest Auth', 'ONVIF'],
    features: ['RTSP', 'ONVIF', 'SDK', 'Cloud P2P'],
  },
  dahua: {
    name: 'Dahua',
    patterns: {
      http: [/dahua/i, /dh-/i],
      headers: {
        'Server': /Dahua/i,
      },
    },
    ports: {
      http: [80, 8000, 8080],
      rtsp: [554],
      onvif: [80],
      admin: [80],
    },
    defaultCredentials: [
      { username: 'admin', password: 'admin', description: 'Domyślne' },
      { username: 'admin', password: '', description: 'Puste hasło' },
      { username: '666666', password: '666666', description: 'Alternatywne' },
    ],
    authMethods: ['Basic Auth', 'Digest Auth', 'ONVIF'],
    features: ['RTSP', 'ONVIF', 'P2P', 'Smart Codec'],
  },
  axis: {
    name: 'Axis',
    patterns: {
      http: [/axis/i, /vapix/i],
      headers: {
        'Server': /AXIS/i,
      },
    },
    ports: {
      http: [80, 443],
      rtsp: [554],
      onvif: [80],
      admin: [80],
    },
    defaultCredentials: [
      { username: 'root', password: 'pass', description: 'Domyślne (stare)' },
      { username: 'root', password: '', description: 'Puste hasło' },
    ],
    authMethods: ['Basic Auth', 'Digest Auth', 'ONVIF', 'VAPIX'],
    features: ['RTSP', 'ONVIF', 'VAPIX API', 'Edge Analytics'],
  },
  reolink: {
    name: 'Reolink',
    patterns: {
      http: [/reolink/i],
      headers: {
        'Server': /Reolink/i,
      },
    },
    ports: {
      http: [80, 8000, 9000],
      rtsp: [554],
      onvif: [8000],
      admin: [9000],
    },
    defaultCredentials: [
      { username: 'admin', password: '', description: 'Puste hasło (domyślne)' },
      { username: 'admin', password: 'admin', description: 'Alternatywne' },
    ],
    authMethods: ['Basic Auth', 'ONVIF'],
    features: ['RTSP', 'ONVIF', 'P2P', 'AI Detection'],
  },
  uniview: {
    name: 'Uniview (UNV)',
    patterns: {
      http: [/uniview/i, /unv/i],
    },
    ports: {
      http: [80],
      rtsp: [554],
      onvif: [80],
      admin: [80],
    },
    defaultCredentials: [
      { username: 'admin', password: '123456', description: 'Domyślne' },
      { username: 'admin', password: 'admin', description: 'Alternatywne' },
    ],
    authMethods: ['Basic Auth', 'Digest Auth', 'ONVIF'],
    features: ['RTSP', 'ONVIF', 'EZView'],
  },
  foscam: {
    name: 'Foscam',
    patterns: {
      http: [/foscam/i],
    },
    ports: {
      http: [80, 88],
      rtsp: [554, 88],
      onvif: [80],
      admin: [88],
    },
    defaultCredentials: [
      { username: 'admin', password: '', description: 'Puste hasło' },
      { username: 'admin', password: 'admin', description: 'Alternatywne' },
    ],
    authMethods: ['Basic Auth', 'ONVIF'],
    features: ['RTSP', 'ONVIF', 'P2P', 'CGI API'],
  },
  tplink: {
    name: 'TP-Link',
    patterns: {
      http: [/tp-link/i, /tapo/i],
    },
    ports: {
      http: [80, 443],
      rtsp: [554],
      onvif: [2020],
      admin: [80],
    },
    defaultCredentials: [
      { username: 'admin', password: 'admin', description: 'Domyślne' },
    ],
    authMethods: ['Basic Auth', 'ONVIF', 'Tapo Protocol'],
    features: ['RTSP', 'ONVIF', 'Cloud', 'Motion Detection'],
  },
  generic: {
    name: 'Generic IP Camera',
    patterns: {
      http: [/ipcam/i, /webcam/i, /camera/i],
    },
    ports: {
      http: [80, 8080, 8000, 81, 82],
      rtsp: [554, 8554, 7447],
      onvif: [80, 8080],
      admin: [80],
    },
    defaultCredentials: [
      { username: 'admin', password: 'admin', description: 'Najpopularniejsze' },
      { username: 'admin', password: '12345', description: 'Popularne' },
      { username: 'admin', password: '', description: 'Puste hasło' },
      { username: 'root', password: 'root', description: 'Root access' },
    ],
    authMethods: ['Basic Auth', 'Digest Auth', 'ONVIF'],
    features: ['RTSP', 'HTTP', 'ONVIF'],
  },
};

export interface PortScanResult {
  port: number;
  protocol: string;
  service: string;
  open: boolean;
  banner?: string;
  headers?: Record<string, string>;
  responseTime?: number;
}

export interface CameraDetectionResult {
  ip: string;
  vendor?: string;
  vendorConfidence: number; // 0-100
  model?: string;
  openPorts: PortScanResult[];
  detectedServices: string[];
  authMethods: string[];
  defaultCredentials: Array<{
    username: string;
    password: string;
    description: string;
  }>;
  rtspUrls: string[];
  httpUrls: string[];
  onvifUrl?: string;
  features: string[];
  recommendations: string[];
}

/**
 * Comprehensive port list for camera detection
 */
export const CAMERA_PORTS = {
  // HTTP/Web interfaces
  http: [80, 81, 82, 83, 8000, 8080, 8081, 8888, 9000],
  // HTTPS
  https: [443, 8443],
  // RTSP streaming
  rtsp: [554, 8554, 7447, 10554],
  // ONVIF
  onvif: [80, 8080, 2020, 3702],
  // Admin/Config
  admin: [8000, 9000, 37777],
  // SDK/API
  sdk: [8000, 37777, 37778],
};

/**
 * Get all unique ports to scan for cameras
 */
export function getAllCameraPorts(): number[] {
  const allPorts = new Set<number>();
  Object.values(CAMERA_PORTS).forEach(ports => {
    ports.forEach(port => allPorts.add(port));
  });
  return Array.from(allPorts).sort((a, b) => a - b);
}

/**
 * Identify camera vendor from HTTP response
 */
export function identifyVendor(
  httpContent: string,
  headers: Record<string, string>
): { vendor: string; confidence: number } | null {
  
  for (const [vendorId, vendor] of Object.entries(CAMERA_VENDORS)) {
    let confidence = 0;
    let matches = 0;
    
    // Check HTTP content patterns
    if (vendor.patterns.http) {
      for (const pattern of vendor.patterns.http) {
        if (pattern.test(httpContent)) {
          confidence += 30;
          matches++;
        }
      }
    }
    
    // Check headers
    if (vendor.patterns.headers) {
      for (const [headerName, pattern] of Object.entries(vendor.patterns.headers)) {
        const headerValue = headers[headerName.toLowerCase()];
        if (headerValue && pattern.test(headerValue)) {
          confidence += 40;
          matches++;
        }
      }
    }
    
    if (matches > 0) {
      return { vendor: vendorId, confidence: Math.min(100, confidence) };
    }
  }
  
  // Check for generic camera indicators
  const genericPatterns = [/camera/i, /ipcam/i, /webcam/i, /nvr/i, /dvr/i];
  for (const pattern of genericPatterns) {
    if (pattern.test(httpContent)) {
      return { vendor: 'generic', confidence: 50 };
    }
  }
  
  return null;
}

/**
 * Generate RTSP URLs for a camera
 */
export function generateRtspUrls(ip: string, vendor?: string): string[] {
  const urls: string[] = [];
  
  if (vendor && CAMERA_VENDORS[vendor]) {
    const vendorInfo = CAMERA_VENDORS[vendor];
    
    // Vendor-specific RTSP paths
    const paths: Record<string, string[]> = {
      hikvision: ['/Streaming/Channels/101', '/h264/ch1/main/av_stream', '/ISAPI/Streaming/channels/101'],
      dahua: ['/cam/realmonitor?channel=1&subtype=0', '/live/ch00_0'],
      axis: ['/axis-media/media.amp', '/mjpg/video.mjpg'],
      reolink: ['/h264Preview_01_main', '/Preview_01_main'],
      uniview: ['/media/video1'],
      foscam: ['/videoMain', '/11'],
      tplink: ['/stream1', '/stream2'],
    };
    
    const vendorPaths = paths[vendor] || ['/stream', '/live', '/video'];
    
    for (const port of vendorInfo.ports.rtsp) {
      for (const path of vendorPaths) {
        urls.push(`rtsp://${ip}:${port}${path}`);
      }
    }
  } else {
    // Generic RTSP URLs
    const genericPaths = [
      '/stream', '/live', '/video', '/h264', '/cam', '/media',
      '/Streaming/Channels/101', '/cam/realmonitor?channel=1&subtype=0',
      '/axis-media/media.amp', '/h264Preview_01_main', '/videoMain',
    ];
    
    for (const port of [554, 8554]) {
      for (const path of genericPaths) {
        urls.push(`rtsp://${ip}:${port}${path}`);
      }
    }
  }
  
  return urls;
}

/**
 * Generate recommendations for camera access
 */
export function generateRecommendations(result: CameraDetectionResult): string[] {
  const recommendations: string[] = [];
  
  if (result.vendor) {
    const vendor = CAMERA_VENDORS[result.vendor];
    
    recommendations.push(`🏭 **Producent:** ${vendor.name}`);
    
    if (result.defaultCredentials.length > 0) {
      recommendations.push(`🔑 **Domyślne hasła do przetestowania:**`);
      result.defaultCredentials.forEach(cred => {
        const user = cred.username || '(brak)';
        const pass = cred.password || '(puste)';
        recommendations.push(`   • ${user}:${pass} — ${cred.description}`);
      });
    }
    
    if (result.rtspUrls.length > 0) {
      recommendations.push(`📹 **RTSP URLs do przetestowania:**`);
      result.rtspUrls.slice(0, 3).forEach(url => {
        recommendations.push(`   • ${url}`);
      });
    }
    
    if (result.authMethods.length > 0) {
      recommendations.push(`🔐 **Metody autoryzacji:** ${result.authMethods.join(', ')}`);
    }
    
    if (result.features.length > 0) {
      recommendations.push(`✨ **Funkcje:** ${result.features.join(', ')}`);
    }
  }
  
  return recommendations;
}
