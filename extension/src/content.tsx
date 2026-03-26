import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { SidebarRoot } from "./components/SidebarRoot";

const HOST_ID = "souldraft-extension-root";

function ContentApp() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const listener = (message: { type?: string }) => {
      if (message.type === "SOULDRAFT_TOGGLE_SIDEBAR") {
        setVisible((prev) => !prev);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  return <SidebarRoot visible={visible} onClose={() => setVisible(false)} />;
}

function mount() {
  if (document.getElementById(HOST_ID)) {
    return;
  }

  const host = document.createElement("div");
  host.id = HOST_ID;
  document.documentElement.appendChild(host);

  const root = createRoot(host);
  root.render(
    <StrictMode>
      <ContentApp />
    </StrictMode>
  );
}

mount();
