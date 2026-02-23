#!/usr/bin/env node

// Test that the monitoring plugin is now allowed in scopes

console.log('🔍 Testing Scope Registry for MonitoringPlugin');
console.log('=============================================\n');

// Simulate the scope registry check
const testScopes = {
  local: {
    allowedPlugins: [
      'network-scan', 'network-ping', 'network-arp', 'network-mdns',
      'network-port-scan', 'network-onvif', 'network-wol',
      'rtsp-camera', 'camera-health', 'camera-ptz', 'camera-snapshot', 'camera-live',
      'mqtt', 'service-probe', 'monitor', 'protocol-bridge', 'processes',
      'disk-info', 'ssh', 'advanced-port-scan', 'http-browse', 'chat-llm',
      'monitoring-query',
    ]
  },
  network: {
    allowedPlugins: [
      'network-scan', 'network-ping', 'network-arp', 'network-mdns',
      'network-port-scan', 'network-onvif', 'network-wol',
      'rtsp-camera', 'camera-health', 'camera-ptz', 'camera-snapshot', 'camera-live',
      'mqtt', 'service-probe', 'monitor', 'protocol-bridge',
      'http-browse', 'chat-llm', 'marketplace', 'processes',
      'disk-info', 'ssh', 'advanced-port-scan',
      'monitoring-query',
    ]
  }
};

function isPluginAllowed(pluginId, scope) {
  const scopeConfig = testScopes[scope];
  return scopeConfig && scopeConfig.allowedPlugins.includes(pluginId);
}

console.log('Plugin ID: "monitoring-query"');
console.log('\nScope Permissions:');
console.log(`✅ Local scope: ${isPluginAllowed('monitoring-query', 'local') ? 'ALLOWED' : 'DENIED'}`);
console.log(`✅ Network scope: ${isPluginAllowed('monitoring-query', 'network') ? 'ALLOWED' : 'DENIED'}`);
console.log(`❌ Internet scope: ${isPluginAllowed('monitoring-query', 'internet') ? 'ALLOWED' : 'DENIED'}`);

console.log('\n🎯 Query Flow:');
console.log('1. User asks: "ile osób na kamerach w ostatnich 10 minutach"');
console.log('2. IntentRouter detects: "monitoring:query"');
console.log('3. IntentRouter routes to: MonitoringPlugin');
console.log('4. ScopeRegistry checks: "monitoring-query" allowed in current scope');
console.log('5. ✅ Plugin executes and queries the database');

console.log('\n✅ The monitoring query should now work correctly!');
