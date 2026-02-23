/**
 * Camera Vendor Database
 * 
 * Contains default credentials, RTSP paths, and HTTP snapshot URLs
 * for popular IP camera manufacturers.
 */

export interface CameraVendor {
  name: string;
  aliases: string[];
  defaultCredentials: Array<{
    username: string;
    password: string;
    description: string;
  }>;
  rtspPaths: Array<{
    path: string;
    description: string;
    quality: 'main' | 'sub' | 'mobile';
  }>;
  httpSnapshotPaths: Array<{
    path: string;
    description: string;
  }>;
  defaultPorts: {
    http: number[];
    rtsp: number[];
  };
  detectionPatterns: {
    hostname?: RegExp[];
    httpHeaders?: string[];
    httpContent?: string[];
  };
}

export const CAMERA_VENDORS: Record<string, CameraVendor> = {
  annke: {
    name: 'Annke (Hikvision OEM)',
    aliases: ['annke'],
    defaultCredentials: [
      { username: 'admin', password: '12345', description: 'Domyślne (stare modele)' },
      { username: 'admin', password: 'admin', description: 'Alternatywne' },
      { username: 'admin', password: '', description: 'Bez hasła (stare modele)' },
      { username: 'admin', password: '123456', description: 'Popularne' },
    ],
    rtspPaths: [
      { path: '/Streaming/Channels/101', description: 'Główny kanał (H.264)', quality: 'main' },
      { path: '/Streaming/Channels/102', description: 'Sub-stream (niższa jakość)', quality: 'sub' },
      { path: '/h264/ch1/main/av_stream', description: 'Legacy główny', quality: 'main' },
      { path: '/h264/ch1/sub/av_stream', description: 'Legacy sub', quality: 'sub' },
      { path: '/live/ch00_0', description: 'NC-series main', quality: 'main' },
      { path: '/live/ch00_1', description: 'NC-series sub', quality: 'sub' },
    ],
    httpSnapshotPaths: [
      { path: '/ISAPI/Streaming/channels/101/picture', description: 'ISAPI główny kanał' },
      { path: '/ISAPI/Streaming/channels/102/picture', description: 'ISAPI sub-stream' },
      { path: '/Streaming/channels/1/picture', description: 'Snapshot kanał 1' },
    ],
    defaultPorts: {
      http: [80, 8000],
      rtsp: [554],
    },
    detectionPatterns: {
      hostname: [/annke/i],
      httpContent: ['ANNKE', 'Annke'],
    },
  },

  hikvision: {
    name: 'Hikvision',
    aliases: ['hikvision', 'hik', 'ds-', 'ivms'],
    defaultCredentials: [
      { username: 'admin', password: '12345', description: 'Domyślne fabryczne' },
      { username: 'admin', password: 'admin', description: 'Alternatywne' },
      { username: 'admin', password: '', description: 'Bez hasła (stare modele)' },
      { username: 'admin', password: '123456', description: 'Popularne' },
      { username: 'admin', password: 'hik12345', description: 'Niektóre modele' },
    ],
    rtspPaths: [
      { path: '/Streaming/Channels/101', description: 'Główny kanał (H.264)', quality: 'main' },
      { path: '/Streaming/Channels/102', description: 'Sub-stream (niższa jakość)', quality: 'sub' },
      { path: '/Streaming/Channels/1', description: 'Kanał 1 (starsze modele)', quality: 'main' },
      { path: '/Streaming/Channels/2', description: 'Kanał 2 (starsze modele)', quality: 'sub' },
      { path: '/h264/ch1/main/av_stream', description: 'Alternatywny główny', quality: 'main' },
      { path: '/h264/ch1/sub/av_stream', description: 'Alternatywny sub', quality: 'sub' },
    ],
    httpSnapshotPaths: [
      { path: '/ISAPI/Streaming/channels/101/picture', description: 'ISAPI główny kanał' },
      { path: '/ISAPI/Streaming/channels/102/picture', description: 'ISAPI sub-stream' },
      { path: '/ISAPI/Streaming/channels/1/picture', description: 'ISAPI kanał 1' },
      { path: '/Streaming/channels/1/picture', description: 'Snapshot kanał 1' },
    ],
    defaultPorts: {
      http: [80, 8000],
      rtsp: [554],
    },
    detectionPatterns: {
      hostname: [/hikvision/i, /^ds-/i, /ivms/i],
      httpHeaders: ['Server: App-webs/', 'Server: uc-httpd'],
      httpContent: ['Hikvision', 'IVMS', 'iVMS'],
    },
  },

  dahua: {
    name: 'Dahua',
    aliases: ['dahua', 'dh-', 'ipc-'],
    defaultCredentials: [
      { username: 'admin', password: 'admin', description: 'Domyślne fabryczne' },
      { username: 'admin', password: '', description: 'Bez hasła' },
      { username: 'admin', password: '123456', description: 'Popularne' },
      { username: 'admin', password: 'dahua', description: 'Niektóre modele' },
      { username: '888888', password: '888888', description: 'Starsze modele' },
    ],
    rtspPaths: [
      { path: '/cam/realmonitor?channel=1&subtype=0', description: 'Główny stream', quality: 'main' },
      { path: '/cam/realmonitor?channel=1&subtype=1', description: 'Sub-stream', quality: 'sub' },
      { path: '/cam/realmonitor?channel=1&subtype=2', description: 'Mobile stream', quality: 'mobile' },
      { path: '/live', description: 'Live stream (nowsze modele)', quality: 'main' },
    ],
    httpSnapshotPaths: [
      { path: '/cgi-bin/snapshot.cgi', description: 'CGI snapshot' },
      { path: '/cgi-bin/snapshot.cgi?channel=1', description: 'CGI snapshot kanał 1' },
      { path: '/onvifsnapshot/media_service/snapshot', description: 'ONVIF snapshot' },
    ],
    defaultPorts: {
      http: [80, 8000, 8080],
      rtsp: [554],
    },
    detectionPatterns: {
      hostname: [/dahua/i, /^dh-/i, /^ipc-/i],
      httpHeaders: ['Server: Dahua'],
      httpContent: ['Dahua', 'DH-', 'IPC-'],
    },
  },

  reolink: {
    name: 'Reolink',
    aliases: ['reolink', 'rlc-', 'rlk-'],
    defaultCredentials: [
      { username: 'admin', password: '', description: 'Domyślne (bez hasła)' },
      { username: 'admin', password: 'admin', description: 'Jeśli ustawione hasło' },
      { username: 'admin', password: '123456', description: 'Popularne' },
    ],
    rtspPaths: [
      { path: '/h264Preview_01_main', description: 'Główny stream (H.264)', quality: 'main' },
      { path: '/h264Preview_01_sub', description: 'Sub-stream (H.264)', quality: 'sub' },
      { path: '/h265Preview_01_main', description: 'Główny stream (H.265)', quality: 'main' },
      { path: '/h265Preview_01_sub', description: 'Sub-stream (H.265)', quality: 'sub' },
      { path: '/Preview_01_main', description: 'Główny (auto codec)', quality: 'main' },
      { path: '/Preview_01_sub', description: 'Sub (auto codec)', quality: 'sub' },
    ],
    httpSnapshotPaths: [
      { path: '/cgi-bin/api.cgi?cmd=Snap&channel=0&rs=wuuPhkmUCeI9WG7C', description: 'API snapshot' },
      { path: '/snap.jpg', description: 'Snapshot JPG' },
    ],
    defaultPorts: {
      http: [80, 8000],
      rtsp: [554],
    },
    detectionPatterns: {
      hostname: [/reolink/i, /^rlc-/i, /^rlk-/i],
      httpContent: ['Reolink', 'RLC-', 'RLK-'],
    },
  },

  axis: {
    name: 'Axis',
    aliases: ['axis', 'axis-'],
    defaultCredentials: [
      { username: 'root', password: 'pass', description: 'Domyślne fabryczne' },
      { username: 'root', password: '', description: 'Bez hasła (stare modele)' },
      { username: 'admin', password: 'admin', description: 'Alternatywne' },
    ],
    rtspPaths: [
      { path: '/axis-media/media.amp', description: 'Główny stream', quality: 'main' },
      { path: '/axis-media/media.amp?videocodec=h264', description: 'H.264 stream', quality: 'main' },
      { path: '/axis-media/media.amp?resolution=640x480', description: 'Sub-stream', quality: 'sub' },
      { path: '/mpeg4/media.amp', description: 'MPEG4 stream', quality: 'main' },
    ],
    httpSnapshotPaths: [
      { path: '/axis-cgi/jpg/image.cgi', description: 'JPG snapshot' },
      { path: '/axis-cgi/bitmap/image.bmp', description: 'BMP snapshot' },
    ],
    defaultPorts: {
      http: [80],
      rtsp: [554],
    },
    detectionPatterns: {
      hostname: [/axis/i, /^axis-/i],
      httpHeaders: ['Server: lighttpd'],
      httpContent: ['AXIS', 'axis-cgi'],
    },
  },

  uniview: {
    name: 'Uniview',
    aliases: ['uniview', 'ipc-', 'nvr-'],
    defaultCredentials: [
      { username: 'admin', password: '123456', description: 'Domyślne fabryczne' },
      { username: 'admin', password: 'admin', description: 'Alternatywne' },
      { username: 'admin', password: '', description: 'Bez hasła' },
    ],
    rtspPaths: [
      { path: '/media/video1', description: 'Główny stream', quality: 'main' },
      { path: '/media/video2', description: 'Sub-stream', quality: 'sub' },
      { path: '/video1', description: 'Video 1', quality: 'main' },
    ],
    httpSnapshotPaths: [
      { path: '/onvifsnapshot/media_service/snapshot', description: 'ONVIF snapshot' },
      { path: '/cgi-bin/snapshot.cgi', description: 'CGI snapshot' },
    ],
    defaultPorts: {
      http: [80, 8000],
      rtsp: [554],
    },
    detectionPatterns: {
      hostname: [/uniview/i, /^ipc-/i, /^nvr-/i],
      httpContent: ['Uniview', 'UNV'],
    },
  },

  foscam: {
    name: 'Foscam',
    aliases: ['foscam', 'fi-', 'fc-'],
    defaultCredentials: [
      { username: 'admin', password: '', description: 'Domyślne (bez hasła)' },
      { username: 'admin', password: 'admin', description: 'Jeśli ustawione' },
      { username: 'admin', password: 'foscam', description: 'Niektóre modele' },
    ],
    rtspPaths: [
      { path: '/videoMain', description: 'Główny stream', quality: 'main' },
      { path: '/videoSub', description: 'Sub-stream', quality: 'sub' },
      { path: '/11', description: 'Stream 11 (starsze)', quality: 'main' },
      { path: '/12', description: 'Stream 12 (starsze)', quality: 'sub' },
    ],
    httpSnapshotPaths: [
      { path: '/cgi-bin/CGIProxy.fcgi?cmd=snapPicture2&usr=admin&pwd=', description: 'CGI snapshot' },
      { path: '/snapshot.cgi', description: 'Snapshot CGI' },
    ],
    defaultPorts: {
      http: [80, 88],
      rtsp: [554, 88],
    },
    detectionPatterns: {
      hostname: [/foscam/i, /^fi-/i, /^fc-/i],
      httpContent: ['Foscam', 'FI-', 'FC-'],
    },
  },

  tplink: {
    name: 'TP-Link',
    aliases: ['tp-link', 'tplink', 'tapo'],
    defaultCredentials: [
      { username: 'admin', password: 'admin', description: 'Domyślne fabryczne' },
      { username: 'admin', password: '', description: 'Bez hasła' },
    ],
    rtspPaths: [
      { path: '/stream1', description: 'Główny stream', quality: 'main' },
      { path: '/stream2', description: 'Sub-stream', quality: 'sub' },
      { path: '/live/mpeg4', description: 'MPEG4 stream', quality: 'main' },
    ],
    httpSnapshotPaths: [
      { path: '/snapshot.jpg', description: 'Snapshot JPG' },
    ],
    defaultPorts: {
      http: [80],
      rtsp: [554],
    },
    detectionPatterns: {
      hostname: [/tp-link/i, /tplink/i, /tapo/i],
      httpContent: ['TP-Link', 'Tapo'],
    },
  },

  generic: {
    name: 'Generic/Unknown',
    aliases: ['generic', 'unknown', 'onvif'],
    defaultCredentials: [
      { username: 'admin', password: 'admin', description: 'Najczęstsze' },
      { username: 'admin', password: '12345', description: 'Popularne' },
      { username: 'admin', password: '123456', description: 'Popularne' },
      { username: 'admin', password: '', description: 'Bez hasła' },
      { username: 'root', password: 'root', description: 'Root access' },
      { username: 'root', password: 'pass', description: 'Root alternatywne' },
    ],
    rtspPaths: [
      { path: '/stream', description: 'Generic stream', quality: 'main' },
      { path: '/live', description: 'Live stream', quality: 'main' },
      { path: '/video', description: 'Video stream', quality: 'main' },
      { path: '/cam/realmonitor?channel=1&subtype=0', description: 'Dahua-style', quality: 'main' },
      { path: '/Streaming/Channels/101', description: 'Hikvision-style', quality: 'main' },
      { path: '/h264Preview_01_main', description: 'Reolink-style', quality: 'main' },
    ],
    httpSnapshotPaths: [
      { path: '/snapshot.jpg', description: 'Generic snapshot' },
      { path: '/cgi-bin/snapshot.cgi', description: 'CGI snapshot' },
      { path: '/image.jpg', description: 'Image JPG' },
      { path: '/onvifsnapshot/media_service/snapshot', description: 'ONVIF snapshot' },
    ],
    defaultPorts: {
      http: [80, 8000, 8080],
      rtsp: [554, 8554],
    },
    detectionPatterns: {
      hostname: [],
      httpContent: [],
    },
  },
};

/**
 * RTSP path patterns for vendor detection
 */
const RTSP_PATH_PATTERNS: Record<string, RegExp[]> = {
  reolink:    [/h264Preview_\d+_(main|sub|mobile)/i, /h265Preview_\d+_(main|sub|mobile)/i, /Preview_\d+_(main|sub)/i],
  annke:     [/\/Streaming\/Channels\/\d+/i, /\/h264\/ch\d+\/(main|sub)\/av_stream/i, /\/live\/ch\d+_\d+/i],
  hikvision:  [/\/Streaming\/Channels\/\d+/i, /\/h264\/ch\d+\/(main|sub)\/av_stream/i],
  dahua:      [/\/cam\/realmonitor/i, /channel=\d+&subtype=\d+/i],
  axis:       [/\/axis-media\/media\.amp/i, /\/mpeg4\/media\.amp/i],
  foscam:     [/\/videoMain/i, /\/videoSub/i],
  tplink:     [/\/stream\d+/i, /\/live\/mpeg4/i],
};

/**
 * Detect camera vendor from hostname, MAC address, HTTP response, or RTSP path
 */
export function detectCameraVendor(options: {
  hostname?: string;
  mac?: string;
  httpHeaders?: Record<string, string>;
  httpContent?: string;
  rtspPath?: string;
}): string {
  const { hostname, mac, httpHeaders, httpContent, rtspPath } = options;

  // Check RTSP path first — most reliable when URL is provided
  if (rtspPath) {
    for (const [vendorId, patterns] of Object.entries(RTSP_PATH_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(rtspPath)) {
          return vendorId;
        }
      }
    }
  }

  for (const [vendorId, vendor] of Object.entries(CAMERA_VENDORS)) {
    if (vendorId === 'generic') continue;

    // Check hostname patterns
    if (hostname && vendor.detectionPatterns.hostname) {
      for (const pattern of vendor.detectionPatterns.hostname) {
        if (pattern.test(hostname)) {
          return vendorId;
        }
      }
    }

    // Check HTTP headers
    if (httpHeaders && vendor.detectionPatterns.httpHeaders) {
      for (const headerPattern of vendor.detectionPatterns.httpHeaders) {
        for (const [key, value] of Object.entries(httpHeaders)) {
          if (`${key}: ${value}`.includes(headerPattern)) {
            return vendorId;
          }
        }
      }
    }

    // Check HTTP content
    if (httpContent && vendor.detectionPatterns.httpContent) {
      for (const contentPattern of vendor.detectionPatterns.httpContent) {
        if (httpContent.includes(contentPattern)) {
          return vendorId;
        }
      }
    }

    // Check MAC address (first 6 chars = OUI)
    if (mac) {
      const oui = mac.replace(/[:-]/g, '').substring(0, 6).toUpperCase();
      // Common OUIs for camera vendors
      const vendorOUIs: Record<string, string[]> = {
        hikvision: ['001D72', 'BC3445', '4C11BF', '001F3C'],
        dahua: ['00126C', '08001F', '001D0F'],
        axis: ['00408C', 'ACCC8E', 'B8A44F'],
      };
      
      if (vendorOUIs[vendorId]?.includes(oui)) {
        return vendorId;
      }
    }
  }

  return 'generic';
}

/**
 * Get vendor information by ID
 */
export function getVendorInfo(vendorId: string): CameraVendor {
  return CAMERA_VENDORS[vendorId] || CAMERA_VENDORS.generic;
}

/**
 * Build RTSP URL with vendor-specific path
 */
export function buildRtspUrl(
  ip: string,
  username: string,
  password: string,
  vendorId: string,
  quality: 'main' | 'sub' | 'mobile' = 'main',
  port: number = 554
): string {
  const vendor = getVendorInfo(vendorId);
  const auth = username && password ? `${username}:${password}@` : username ? `${username}@` : '';
  
  // Find matching quality path
  const path = vendor.rtspPaths.find(p => p.quality === quality)?.path || vendor.rtspPaths[0]?.path || '/stream';
  
  return `rtsp://${auth}${ip}:${port}${path}`;
}

/**
 * Build HTTP snapshot URL with vendor-specific path
 */
export function buildSnapshotUrl(
  ip: string,
  username: string,
  password: string,
  vendorId: string,
  port: number = 80
): string {
  const vendor = getVendorInfo(vendorId);
  const auth = username && password ? `${username}:${password}@` : username ? `${username}@` : '';
  
  const path = vendor.httpSnapshotPaths[0]?.path || '/snapshot.jpg';
  
  return `http://${auth}${ip}:${port}${path}`;
}
