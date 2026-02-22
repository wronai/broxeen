/**
 * Test NetworkScanPlugin functionality
 * Simulates network scanning for camera discovery
 */

// Mock NetworkScanner implementation
class MockNetworkScanner {
  async scan() {
    console.log('🔍 Starting network scan...');
    
    // Simulate scan delay
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Mock discovered devices
    return [
      {
        id: '192.168.1.45',
        ip: '192.168.1.45',
        mac: '00:12:34:56:78:9A',
        hostname: 'cam-hikvision-01',
        deviceType: 'camera',
        firstSeen: Date.now() - 3600000,
        lastSeen: Date.now() - 120000,
        isOnline: true,
        metadata: {
          manufacturer: 'Hikvision',
          model: 'DS-2CD2032-I',
          ports: [80, 554],
          services: ['http', 'rtsp']
        }
      },
      {
        id: '192.168.1.67',
        ip: '192.168.1.67',
        mac: '00:12:34:56:78:9B',
        hostname: 'cam-reolink-02',
        deviceType: 'camera',
        firstSeen: Date.now() - 7200000,
        lastSeen: Date.now() - 300000,
        isOnline: true,
        metadata: {
          manufacturer: 'Reolink',
          model: 'RLC-410',
          ports: [80, 443, 554],
          services: ['http', 'https', 'rtsp']
        }
      },
      {
        id: '192.168.1.10',
        ip: '192.168.1.10',
        mac: '00:12:34:56:78:9C',
        hostname: 'nas-server',
        deviceType: 'server',
        firstSeen: Date.now() - 86400000,
        lastSeen: Date.now() - 60000,
        isOnline: true,
        metadata: {
          manufacturer: 'Synology',
          model: 'DS918+',
          ports: [80, 443, 22],
          services: ['http', 'https', 'ssh']
        }
      }
    ];
  }
}

// Mock ServiceProber
class MockServiceProber {
  async probeDevice(device) {
    console.log(`🔧 Probing services on ${device.ip}...`);
    
    // Simulate probing delay
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Return service information
    return {
      deviceId: device.id,
      services: device.metadata.ports.map(port => ({
        port,
        protocol: port === 22 ? 'ssh' : port === 554 ? 'rtsp' : 'http',
        status: 'open',
        details: this.getServiceDetails(port, device)
      }))
    };
  }
  
  getServiceDetails(port, device) {
    switch (port) {
      case 80:
        return {
          title: 'Web Interface',
          description: `HTTP interface for ${device.hostname}`,
          url: `http://${device.ip}`
        };
      case 443:
        return {
          title: 'Secure Web Interface',
          description: `HTTPS interface for ${device.hostname}`,
          url: `https://${device.ip}`
        };
      case 554:
        return {
          title: 'RTSP Stream',
          description: `RTSP video stream from ${device.hostname}`,
          url: `rtsp://${device.ip}:554/stream`
        };
      case 22:
        return {
          title: 'SSH Access',
          description: `SSH access to ${device.hostname}`,
          url: `ssh://${device.ip}`
        };
      default:
        return {
          title: `Service on port ${port}`,
          description: `Unknown service on ${device.hostname}`
        };
    }
  }
}

// Mock NetworkScanPlugin
class MockNetworkScanPlugin {
  constructor() {
    this.id = 'network-scan';
    this.name = 'Network Scanner';
    this.supportedIntents = ['network:scan'];
    this.networkScanner = new MockNetworkScanner();
    this.serviceProber = new MockServiceProber();
  }
  
  async execute(input, context) {
    console.log(`🚀 Executing network scan for: "${input}"`);
    
    try {
      // Step 1: Scan network
      const devices = await this.networkScanner.scan();
      console.log(`📡 Found ${devices.length} devices`);
      
      // Step 2: Probe services on each device
      const devicesWithServices = [];
      for (const device of devices) {
        const services = await this.serviceProber.probeDevice(device);
        devicesWithServices.push({
          ...device,
          services: services.services
        });
      }
      
      // Step 3: Format results
      const result = this.formatResults(devicesWithServices);
      
      return {
        status: 'success',
        content: [
          {
            type: 'text',
            data: result
          }
        ],
        metadata: {
          scanTime: Date.now(),
          deviceCount: devices.length,
          cameraCount: devices.filter(d => d.deviceType === 'camera').length
        }
      };
      
    } catch (error) {
      console.error('❌ Network scan failed:', error);
      return {
        status: 'error',
        content: [
          {
            type: 'text',
            data: `Wystąpił błąd podczas skanowania sieci: ${error.message}`
          }
        ]
      };
    }
  }
  
  formatResults(devices) {
    const cameras = devices.filter(d => d.deviceType === 'camera');
    const others = devices.filter(d => d.deviceType !== 'camera');
    
    let result = `🔍 Skanowanie sieci lokalnej zakończone\n\n`;
    
    if (cameras.length > 0) {
      result += `📷 Znalezione kamery IP (${cameras.length}):\n`;
      cameras.forEach((camera, index) => {
        result += `\n${index + 1}. ${camera.metadata.manufacturer} ${camera.metadata.model}\n`;
        result += `   🌐 Adres: ${camera.ip}\n`;
        result += `   🏷️  Nazwa: ${camera.hostname}\n`;
        result += `   🔌 Porty: ${camera.services.map(s => s.port).join(', ')}\n`;
        result += `   ✅ Status: Online\n`;
        result += `   ⏰ Ostatnio widziany: ${Math.round((Date.now() - camera.lastSeen) / 60000)} min temu\n`;
        
        // Add service details
        camera.services.forEach(service => {
          const details = service.details;
          result += `   🔧 ${details.title}: ${details.url}\n`;
        });
      });
    }
    
    if (others.length > 0) {
      result += `\n💻 Inne znalezione urządzenia (${others.length}):\n`;
      others.forEach((device, index) => {
        result += `\n${index + 1}. ${device.metadata.manufacturer} ${device.metadata.model}\n`;
        result += `   🌐 Adres: ${device.ip}\n`;
        result += `   🏷️  Nazwa: ${device.hostname}\n`;
        result += `   🔌 Porty: ${device.services.map(s => s.port).join(', ')}\n`;
        result += `   ✅ Status: Online\n`;
      });
    }
    
    result += `\n📊 Podsumowanie:\n`;
    result += `- 📷 Kamery: ${cameras.length}\n`;
    result += `- 💻 Inne urządzenia: ${others.length}\n`;
    result += `- 🌐 Łącznie urządzeń: ${devices.length}\n`;
    
    return result;
  }
}

// Test the plugin
async function testNetworkScan() {
  console.log('🧪 Testing NetworkScanPlugin for Camera Discovery\n');
  
  const plugin = new MockNetworkScanPlugin();
  
  // Test camera discovery query
  const testQuery = 'znajdź kamere w sieci lokalnej';
  console.log(`📝 Testing query: "${testQuery}"\n`);
  
  const result = await plugin.execute(testQuery, {
    isTauri: false,
    tauriInvoke: () => {}
  });
  
  console.log('📊 Plugin Execution Result:');
  console.log(`Status: ${result.status}`);
  console.log(`Content blocks: ${result.content.length}`);
  console.log(`Metadata:`, result.metadata);
  console.log('\n📄 Generated Response:');
  console.log('='.repeat(50));
  console.log(result.content[0].data);
  console.log('='.repeat(50));
  
  // Verify results
  const camerasFound = result.metadata.cameraCount;
  const totalDevices = result.metadata.deviceCount;
  
  console.log('\n✅ Test Results:');
  console.log(`📷 Cameras found: ${camerasFound}`);
  console.log(`🌐 Total devices: ${totalDevices}`);
  console.log(`🎯 Expected: 2 cameras, 3 total devices`);
  
  if (camerasFound === 2 && totalDevices === 3) {
    console.log('🎉 Network scan test PASSED!');
  } else {
    console.log('❌ Network scan test FAILED!');
  }
}

// Run the test
testNetworkScan().catch(console.error);
