const { invoke } = window.__TAURI__.core;

// Test the resize_image command
async function testThumbnail() {
  try {
    // Create a simple test image (1x1 pixel red JPEG in base64)
    const testImageBase64 = "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwA/8A8A";
    
    console.log('Testing resize_image with 1x1 pixel image...');
    const result = await invoke('resize_image', {
      base64: testImageBase64,
      maxWidth: 100
    });
    
    console.log('Resize result length:', result.length);
    console.log('First 50 chars:', result.substring(0, 50));
    
    // Test with a real camera frame
    console.log('\nTesting with real camera frame...');
    const rtspResult = await invoke('rtsp_capture_frame', {
      url: 'rtsp://admin:123456@192.168.188.146:554/h264Preview_01_main',
      cameraId: 'test-camera',
      camera_id: 'test-camera'
    });
    
    console.log('RTSP frame captured, length:', rtspResult.base64.length);
    
    const thumbnailResult = await invoke('resize_image', {
      base64: rtspResult.base64,
      maxWidth: 500
    });
    
    console.log('Thumbnail created, length:', thumbnailResult.length);
    console.log('Size reduction:', ((rtspResult.base64.length - thumbnailResult.length) / rtspResult.base64.length * 100).toFixed(1) + '%');
    
  } catch (error) {
    console.error('Test failed:', error);
  }
}

// Run the test
testThumbnail();
