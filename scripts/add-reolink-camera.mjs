#!/usr/bin/env node

/**
 * Add the discovered Reolink camera to Broxeen's device database
 */

import { DatabaseManager } from '../src/persistence/databaseManager.ts';
import { DeviceRepository } from '../src/persistence/deviceRepository.ts';
import { TauriDbAdapter } from '../src/persistence/databaseManager.ts';

// Camera device information
const camera = {
  id: '192.168.188.146',
  ip: '192.168.188.146',
  hostname: 'reolink-camera',
  mac: null, // Not discovered yet
  vendor: 'Reolink',
};

// Camera services (RTSP streams and HTTP API)
const services = [
  {
    id: 'rtsp-main-h264',
    deviceId: camera.id,
    type: 'rtsp',
    port: 554,
    path: '/h264Preview_01_main',
    status: 'online',
    metadata: {
      codec: 'h264',
      quality: 'main',
      url: `rtsp://admin:123456@${camera.ip}:554/h264Preview_01_main`,
      credentials: { username: 'admin', password: '123456' }
    }
  },
  {
    id: 'rtsp-sub-h264',
    deviceId: camera.id,
    type: 'rtsp',
    port: 554,
    path: '/h264Preview_01_sub',
    status: 'online',
    metadata: {
      codec: 'h264',
      quality: 'sub',
      url: `rtsp://admin:123456@${camera.ip}:554/h264Preview_01_sub`,
      credentials: { username: 'admin', password: '123456' }
    }
  },
  {
    id: 'rtsp-main-h265',
    deviceId: camera.id,
    type: 'rtsp',
    port: 554,
    path: '/h265Preview_01_main',
    status: 'online',
    metadata: {
      codec: 'h265',
      quality: 'main',
      url: `rtsp://admin:123456@${camera.ip}:554/h265Preview_01_main`,
      credentials: { username: 'admin', password: '123456' }
    }
  },
  {
    id: 'rtsp-sub-h265',
    deviceId: camera.id,
    type: 'rtsp',
    port: 554,
    path: '/h265Preview_01_sub',
    status: 'online',
    metadata: {
      codec: 'h265',
      quality: 'sub',
      url: `rtsp://admin:123456@${camera.ip}:554/h265Preview_01_sub`,
      credentials: { username: 'admin', password: '123456' }
    }
  },
  {
    id: 'http-snapshot-api',
    deviceId: camera.id,
    type: 'http',
    port: 80,
    path: '/cgi-bin/api.cgi',
    status: 'online',
    metadata: {
      service: 'snapshot',
      url: `http://admin:123456@${camera.ip}/cgi-bin/api.cgi?cmd=Snap&channel=0&rs=wuuPhkmUCeI9WG7C`,
      credentials: { username: 'admin', password: '123456' }
    }
  },
  {
    id: 'http-snapshot-jpg',
    deviceId: camera.id,
    type: 'http',
    port: 80,
    path: '/snap.jpg',
    status: 'online',
    metadata: {
      service: 'snapshot',
      url: `http://admin:123456@${camera.ip}/snap.jpg`,
      credentials: { username: 'admin', password: '123456' }
    }
  },
  {
    id: 'http-web-interface',
    deviceId: camera.id,
    type: 'http',
    port: 80,
    path: '/',
    status: 'online',
    metadata: {
      service: 'web-interface',
      url: `http://${camera.ip}`,
      credentials: { username: 'admin', password: '123456' }
    }
  }
];

async function addCamera() {
  console.log('📹 Adding Reolink camera to Broxeen database...');
  
  try {
    // Initialize database manager
    const dbManager = new DatabaseManager();
    await dbManager.initialize();
    
    // Get device repository
    const deviceRepo = new DeviceRepository(dbManager.getAdapter('broxeen_devices'));
    
    // Save the camera device
    await deviceRepo.saveDevice(camera);
    console.log(`✅ Device saved: ${camera.vendor} camera at ${camera.ip}`);
    
    // Save all services
    for (const service of services) {
      await deviceRepo.saveService(service);
      console.log(`✅ Service saved: ${service.type} - ${service.metadata.service || service.metadata.codec} (${service.path})`);
    }
    
    console.log('\n🎉 Camera successfully added to Broxeen!');
    console.log(`📊 Total services: ${services.length}`);
    console.log('\n💡 You can now:');
    console.log('   - View live streams from this camera');
    console.log('   - Capture snapshots');
    console.log('   - Monitor camera status');
    console.log('   - Access camera via Broxeen interface');
    
  } catch (error) {
    console.error('❌ Failed to add camera:', error);
    process.exit(1);
  }
}

// Run the script
addCamera();
