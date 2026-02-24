// Test script to check if monitoring is working
const { invoke } = window.__TAURI__.core;

async function testMonitoring() {
  try {
    console.log('Testing monitoring system...');
    
    // Check if we can capture a frame
    console.log('1. Testing RTSP frame capture...');
    const frame = await invoke('rtsp_capture_frame', {
      url: 'rtsp://admin:123456@192.168.188.146:554/h264Preview_01_main',
      cameraId: 'test-camera',
      camera_id: 'test-camera'
    });
    
    console.log('Frame captured:', frame.base64 ? 'YES' : 'NO');
    console.log('Frame size:', frame.base64?.length || 0, 'bytes');
    
    // Test thumbnail generation
    console.log('2. Testing thumbnail generation...');
    const thumbnail = await invoke('resize_image', {
      base64: frame.base64,
      maxWidth: 500
    });
    
    console.log('Thumbnail generated:', thumbnail ? 'YES' : 'NO');
    console.log('Thumbnail size:', thumbnail?.length || 0, 'bytes');
    
    // Test monitoring configuration
    console.log('3. Checking monitoring configuration...');
    
    // Emit a test event to check if UI receives it
    window.dispatchEvent(new CustomEvent('broxeen:monitor_change', {
      detail: {
        targetId: 'test-camera',
        targetName: 'Kamera 192.168.188.146',
        targetType: 'camera',
        timestamp: Date.now(),
        changeScore: 0.5,
        summary: 'Test event - osoba wykryta w pomieszczeniu',
        thumbnailBase64: thumbnail,
        thumbnailMimeType: 'image/jpeg'
      }
    }));
    
    console.log('Test monitoring event dispatched');
    
  } catch (error) {
    console.error('Test failed:', error);
  }
}

// Run the test
testMonitoring();
