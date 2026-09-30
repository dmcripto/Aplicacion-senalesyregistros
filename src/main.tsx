import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { LangProvider } from "./lang";
import ErrorBoundary from "./components/ErrorBoundary";
import { installGlobalErrorHandlers } from "./errorReport";

installGlobalErrorHandlers();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <LangProvider>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </LangProvider>,
);
