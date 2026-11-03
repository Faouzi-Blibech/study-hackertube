/// <reference types="chrome" />
// Service worker: clicking the toolbar icon opens the side panel (Chrome, Edge).
// Browsers without chrome.sidePanel (Opera, Opera GX) open the same page in a tab instead.
const hasSidePanel = typeof chrome.sidePanel?.setPanelBehavior === 'function';

if (hasSidePanel) {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
} else {
  chrome.action.onClicked.addListener(() => {
    void chrome.tabs.create({ url: chrome.runtime.getURL('sidepanel.html') });
  });
}
