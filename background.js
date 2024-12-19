// Basic background script for extension functionality
chrome.runtime.onInstalled.addListener(() => {
  console.log('Gmail Quote Generator installed');
});

// Keep service worker active
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  return true;
}); 