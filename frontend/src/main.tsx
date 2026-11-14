import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import { AppProvider } from "./lib/context";
import Alerts from "./pages/Alerts";
import Body from "./pages/Body";
import Devices from "./pages/Devices";
import Environment from "./pages/Environment";
import Exercise from "./pages/Exercise";
import Lab from "./pages/Lab";
import Nutrition from "./pages/Nutrition";
import Sources from "./pages/Sources";
import Surgeon from "./pages/Surgeon";
import Today from "./pages/Today";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/surgeon" element={<Surgeon />} />
          <Route element={<Layout />}>
            <Route index element={<Today />} />
            <Route path="exercise" element={<Exercise />} />
            <Route path="body" element={<Body />} />
            <Route path="nutrition" element={<Nutrition />} />
            <Route path="lab" element={<Lab />} />
            <Route path="environment" element={<Environment />} />
            <Route path="devices" element={<Devices />} />
            <Route path="sources" element={<Sources />} />
            <Route path="alerts" element={<Alerts />} />
            <Route path="*" element={<Today />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AppProvider>
  </React.StrictMode>,
);
