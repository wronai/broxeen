// Simple test to check plugin registration
console.log('Starting debug test...');

// Wait for page to load
setTimeout(() => {
  console.log('Page loaded, checking plugins...');
  
  // Try to access plugin context
  const input = document.querySelector('input[type="text"]');
  if (input) {
    console.log('Found input field');
    input.value = 'wyłącz mikrofon';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    
    // Find send button and click
    const sendButton = document.querySelector('button[type="submit"]');
    if (sendButton) {
      console.log('Clicking send button...');
      sendButton.click();
    }
  }
}, 2000);
