// Test script to verify microphone toggle functionality
// This can be run in the browser console when the app is loaded

console.log('🎤 Testing microphone toggle functionality...');

// Check if the microphone button is visible
const micButton = document.querySelector('button[title*="mikrofon"], button[title*="Włącz mikrofon"]');
if (micButton) {
  console.log('✅ Microphone button found:', micButton);
  
  // Check initial state - should be dark/deactivated
  const isInitiallyActive = micButton.classList.contains('bg-green-600');
  console.log('🔍 Initial state - Active:', isInitiallyActive);
  
  // Simulate click to test toggle
  console.log('🖱️ Simulating microphone button click...');
  micButton.click();
  
  // Check state after click
  setTimeout(() => {
    const isActiveAfterClick = micButton.classList.contains('bg-green-600');
    console.log('🔍 State after click - Active:', isActiveAfterClick);
    
    // Check if icon changed
    const micIcon = micButton.querySelector('svg');
    console.log('🎨 Icon after click:', micIcon);
    
    console.log('🎤 Microphone toggle test completed!');
  }, 100);
} else {
  console.log('❌ Microphone button not found');
  console.log('Available buttons:', document.querySelectorAll('button'));
}

// Check for status indicator
const statusIndicator = document.querySelector('span[title*="Mikrofon"], span.ml-1');
if (statusIndicator) {
  console.log('📊 Status indicator found:', statusIndicator.textContent);
  console.log('🎨 Status indicator classes:', statusIndicator.className);
} else {
  console.log('❌ Status indicator not found');
}
