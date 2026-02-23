-- Add Reolink camera to Broxeen database
-- Camera: 192.168.188.146 (Reolink)

-- Insert the camera device
INSERT OR REPLACE INTO devices (id, ip, hostname, mac, vendor, last_seen, created_at, updated_at)
VALUES (
  '192.168.188.146',
  '192.168.188.146', 
  'reolink-camera',
  NULL,
  'Reolink',
  strftime('%s', 'now') * 1000,
  strftime('%s', 'now') * 1000,
  strftime('%s', 'now') * 1000
);

-- Insert RTSP and HTTP services
INSERT OR REPLACE INTO device_services (id, device_id, type, port, path, status, metadata, created_at, updated_at)
VALUES 
-- RTSP Main H.264
('rtsp-main-h264', '192.168.188.146', 'rtsp', 554, '/h264Preview_01_main', 'online', 
 '{"codec":"h264","quality":"main","url":"rtsp://admin:123456@192.168.188.146:554/h264Preview_01_main","credentials":{"username":"admin","password":"123456"}}',
 strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000),

-- RTSP Sub H.264
('rtsp-sub-h264', '192.168.188.146', 'rtsp', 554, '/h264Preview_01_sub', 'online',
 '{"codec":"h264","quality":"sub","url":"rtsp://admin:123456@192.168.188.146:554/h264Preview_01_sub","credentials":{"username":"admin","password":"123456"}}',
 strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000),

-- RTSP Main H.265
('rtsp-main-h265', '192.168.188.146', 'rtsp', 554, '/h265Preview_01_main', 'online',
 '{"codec":"h265","quality":"main","url":"rtsp://admin:123456@192.168.188.146:554/h265Preview_01_main","credentials":{"username":"admin","password":"123456"}}',
 strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000),

-- RTSP Sub H.265
('rtsp-sub-h265', '192.168.188.146', 'rtsp', 554, '/h265Preview_01_sub', 'online',
 '{"codec":"h265","quality":"sub","url":"rtsp://admin:123456@192.168.188.146:554/h265Preview_01_sub","credentials":{"username":"admin","password":"123456"}}',
 strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000),

-- HTTP Snapshot API
('http-snapshot-api', '192.168.188.146', 'http', 80, '/cgi-bin/api.cgi', 'online',
 '{"service":"snapshot","url":"http://admin:123456@192.168.188.146/cgi-bin/api.cgi?cmd=Snap&channel=0&rs=wuuPhkmUCeI9WG7C","credentials":{"username":"admin","password":"123456"}}',
 strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000),

-- HTTP Snapshot JPG
('http-snapshot-jpg', '192.168.188.146', 'http', 80, '/snap.jpg', 'online',
 '{"service":"snapshot","url":"http://admin:123456@192.168.188.146/snap.jpg","credentials":{"username":"admin","password":"123456"}}',
 strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000),

-- HTTP Web Interface
('http-web-interface', '192.168.188.146', 'http', 80, '/', 'online',
 '{"service":"web-interface","url":"http://192.168.188.146","credentials":{"username":"admin","password":"123456"}}',
 strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000);

-- Verify insertion
SELECT 
  d.id as device_id,
  d.ip,
  d.vendor,
  d.hostname,
  COUNT(ds.id) as service_count
FROM devices d
LEFT JOIN device_services ds ON d.id = ds.device_id
WHERE d.id = '192.168.188.146'
GROUP BY d.id, d.ip, d.vendor, d.hostname;
