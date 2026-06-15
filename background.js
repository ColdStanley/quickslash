console.log('QuickSlash background initialized');

// Side Panel Open Helper (with timeout for unresponsive environments like Atlas)
const runSidePanelOperation = async (operation) => {
  try {
    await new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('Operation timed out'));
      }, 1000);

      operation(() => {
        clearTimeout(timeoutId);
        const error = chrome.runtime?.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve();
      });
    });
    return true;
  } catch (error) {
    console.warn('QuickSlash side panel operation failed:', error);
    return false;
  }
};

const openSidePanel = async (tabId) => {
  const success = await runSidePanelOperation((done) => {
    chrome.sidePanel.open({ tabId }, done);
  });

  if (!success) {
    console.warn('QuickSlash: Side Panel open failed.');
  }
  return success;
};

chrome.runtime.onInstalled.addListener(async () => {
  // Set default panel behavior
  await chrome.sidePanel.setOptions({
    path: 'popup/index.html',
    enabled: true
  });
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id) {
    await openSidePanel(tab.id);
  }
});
