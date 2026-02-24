// Simulate enabling monitoring and test thumbnail generation
const { invoke } = window.__TAURI__.core;

async function simulateMonitoring() {
  console.log('=== Simulating Monitoring Enable ===');
  
  try {
    // 1. Get camera configuration from database
    console.log('1. Getting camera configuration...');
    
    // Simulate the target configuration that would be loaded
    const target = {
      id: 'camera-192.168.188.146',
      configuredDeviceId: 'cd_1771855535008_dddi9s',
      type: 'camera',
      name: 'Kamera 192.168.188.146',
      address: '192.168.188.146',
      intervalMs: 3000,
      threshold: 0.15,
      active: true,
      startedAt: Date.now(),
      changeCount: 0,
      logs: [{
        timestamp: Date.now(),
        type: 'start',
        message: 'Rozpoczęto monitoring (włączono): Kamera 192.168.188.146',
      }],
      rtspUrl: 'rtsp://admin:123456@192.168.188.146:554/h264Preview_01_main',
      httpUrl: undefined,
      rtspUsername: 'admin',
      rtspPassword: '123456',
      snapshotUrl: undefined,
    };
    
    console.log('✅ Target configuration loaded');
    console.log(`   RTSP URL: ${target.rtspUrl}`);
    console.log(`   Interval: ${target.intervalMs}ms`);
    console.log(`   Threshold: ${(target.threshold * 100)}%`);
    
    // 2. Test RTSP capture
    console.log('\n2. Testing RTSP capture...');
    const frame = await invoke('rtsp_capture_frame', {
      url: target.rtspUrl,
      cameraId: target.id,
      camera_id: target.id,
    });
    
    if (frame.base64) {
      console.log('✅ RTSP frame captured');
      console.log(`   Size: ${frame.base64.length} bytes`);
      console.log(`   Resolution: ${frame.width}x${frame.height}`);
      console.log(`   Frame age: ${frame.frame_age_ms}ms`);
      console.log(`   Frame count: ${frame.frame_count}`);
    } else {
      console.log('❌ No frame captured');
      return;
    }
    
    // 3. Test thumbnail generation
    console.log('\n3. Testing thumbnail generation...');
    const thumbnail = await invoke('resize_image', {
      base64: frame.base64,
      maxWidth: 500,
    });
    
    if (thumbnail && thumbnail.length > 0) {
      console.log('✅ Thumbnail generated');
      console.log(`   Original: ${frame.base64.length} bytes`);
      console.log(`   Thumbnail: ${thumbnail.length} bytes`);
      console.log(`   Compression: ${((1 - thumbnail.length / frame.base64.length) * 100).toFixed(1)}%`);
    } else {
      console.log('❌ Thumbnail generation failed');
      return;
    }
    
    // 4. Simulate a monitoring event with thumbnail
    console.log('\n4. Simulating monitoring event...');
    const event = {
      targetId: target.id,
      targetName: target.name,
      targetType: target.type,
      timestamp: Date.now(),
      changeScore: 0.85,
      summary: 'Osoba przy biurku lekko pochyliła głowę do przodu',
      thumbnailBase64: thumbnail,
      thumbnailMimeType: 'image/jpeg',
    };
    
    // Dispatch the event
    window.dispatchEvent(new CustomEvent('broxeen:monitor_change', {
      detail: event
    }));
    
    console.log('✅ Monitoring event dispatched');
    console.log(`   Change score: ${(event.changeScore * 100)}%`);
    console.log(`   Summary: ${event.summary}`);
    console.log(`   Thumbnail included: ${event.thumbnailBase64 ? 'YES' : 'NO'}`);
    console.log(`   Thumbnail size: ${event.thumbnailBase64?.length || 0} bytes`);
    
    // 5. Test data URL creation (for debugging)
    if (event.thumbnailBase64) {
      const dataUrl = `data:image/jpeg;base64,${event.thumbnailBase64.substring(0, 100)}...`;
      console.log('\n5. Data URL sample:');
      console.log(`   data:image/jpeg;base64,${event.thumbnailBase64.substring(0, 50)}...[truncated]`);
      
      // Test if the data URL would be valid
      const img = new Image();
      img.onload = () => console.log('✅ Data URL would be valid for image display');
      img.onerror = () => console.log('❌ Data URL invalid for image display');
      img.src = `data:image/jpeg;base64,${event.thumbnailBase64.substring(0, 1000)}`;
    }
    
    console.log('\n=== Monitoring Simulation Complete ===');
    console.log('If you see this message and no errors appear in console,');
    console.log('the monitoring system should work when enabled in UI.');
    console.log('To enable monitoring in UI, type: "uruchom monitoring Kamera 192.168.188.146"');
    
  } catch (error) {
    console.error('❌ Simulation failed:', error);
  }
}

// Auto-run after page loads
if (window.__TAURI__) {
  console.log('Tauri detected, running monitoring simulation...');
  setTimeout(simulateMonitoring, 1000);
} else {
  console.log('Tauri not detected, please run in Tauri environment');
}
