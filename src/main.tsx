// entry point for the react app
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import Landing from "./pages/Landing";
import Dashboard from "./pages/Dashboard";
import "./index.css";

// mount the app into #root and set up client-side routing
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        {/* landing page with the url input */}
        <Route path="/" element={<Landing />} />
        {/* dashboard for a specific site agent */}
        <Route path="/site/:agentId" element={<Dashboard />} />
        {/* anything else goes back to landing */}
        <Route path="*" element={<Landing />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
