chrome.commands.onCommand.addListener(async (command: string) => {
  if (command !== "toggle-sidebar") {
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab.id) {
    return;
  }

  await chrome.tabs.sendMessage(tab.id, { type: "SOULDRAFT_TOGGLE_SIDEBAR" });
});
