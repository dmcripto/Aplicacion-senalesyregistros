import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { LangProvider } from "./lang";
import ErrorBoundary from "./components/ErrorBoundary";
import { installGlobalErrorHandlers } from "./errorReport";
import { captureRef } from "./refTracking";
import { reloadOnceForNewVersion } from "./staleChunk";

installGlobalErrorHandlers();
window.addEventListener("vite:preloadError", (ev) => {
  ev.preventDefault();
  reloadOnceForNewVersion();
});
captureRef();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <LangProvider>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </LangProvider>,
);
