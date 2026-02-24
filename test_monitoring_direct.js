// Direct test of monitoring functionality
const { invoke } = window.__TAURI__.core;

async function testMonitoringDirect() {
  console.log('=== Testing Monitoring Directly ===');
  
  try {
    // 1. Test RTSP frame capture
    console.log('1. Testing RTSP frame capture...');
    const frame = await invoke('rtsp_capture_frame', {
      url: 'rtsp://admin:123456@192.168.188.146:554/h264Preview_01_main',
      cameraId: 'camera-192.168.188.146',
      camera_id: 'camera-192.168.188.146'
    });
    
    if (frame.base64) {
      console.log('✅ Frame captured successfully');
      console.log(`   Size: ${frame.base64.length} bytes`);
      console.log(`   Resolution: ${frame.width}x${frame.height}`);
      console.log(`   Frame age: ${frame.frame_age_ms}ms`);
    } else {
      console.log('❌ No frame captured');
      return;
    }
    
    // 2. Test thumbnail generation
    console.log('\n2. Testing thumbnail generation...');
    const thumbnail = await invoke('resize_image', {
      base64: frame.base64,
      maxWidth: 500
    });
    
    if (thumbnail && thumbnail.length > 0) {
      console.log('✅ Thumbnail generated successfully');
      console.log(`   Original size: ${frame.base64.length} bytes`);
      console.log(`   Thumbnail size: ${thumbnail.length} bytes`);
      console.log(`   Compression: ${((1 - thumbnail.length / frame.base64.length) * 100).toFixed(1)}%`);
    } else {
      console.log('❌ Thumbnail generation failed');
    }
    
    // 3. Create a test monitoring event
    console.log('\n3. Creating test monitoring event...');
    const testEvent = {
      targetId: 'camera-192.168.188.146',
      targetName: 'Kamera 192.168.188.146',
      targetType: 'camera',
      timestamp: Date.now(),
      changeScore: 0.8,
      summary: 'Test: Osoba przy biurku wykryta z miniaturą',
      thumbnailBase64: thumbnail,
      thumbnailMimeType: 'image/jpeg'
    };
    
    // Dispatch event to UI
    window.dispatchEvent(new CustomEvent('broxeen:monitor_change', {
      detail: testEvent
    }));
    
    console.log('✅ Test monitoring event dispatched');
    console.log(`   Event includes thumbnail: ${thumbnail ? 'YES' : 'NO'}`);
    console.log(`   Thumbnail length: ${thumbnail?.length || 0} bytes`);
    
    // 4. Test data URL creation
    if (thumbnail) {
      const dataUrl = `data:image/jpeg;base64,${thumbnail.substring(0, 100)}...`;
      console.log('\n4. Data URL preview:');
      console.log(`   data:image/jpeg;base64,${thumbnail.substring(0, 50)}...`);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Auto-run test
console.log('Opening browser console...');
setTimeout(testMonitoringDirect, 1000);
