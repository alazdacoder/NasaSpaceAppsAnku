import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { CrewLayout, TeamLayout } from "./components/Shell";
import { AppProvider } from "./lib/context";
import { LangProvider } from "./lib/i18n";
import AlertsPage from "./pages/AlertsPage";
import Portal from "./pages/Portal";
import CrewBody from "./pages/crew/Body";
import CrewEnergy from "./pages/crew/Energy";
import CrewExercise from "./pages/crew/Exercise";
import CrewFood from "./pages/crew/Food";
import CrewMind from "./pages/crew/Mind";
import CrewOcular from "./pages/crew/Ocular";
import CrewReturn from "./pages/crew/Return";
import CrewToday from "./pages/crew/Today";
import TeamDevices from "./pages/team/Devices";
import TeamEnvironment from "./pages/team/Environment";
import TeamExerciseEnergy from "./pages/team/ExerciseEnergy";
import TeamLsah from "./pages/team/Lsah";
import TeamMind from "./pages/team/Mind";
import TeamNutrition from "./pages/team/Nutrition";
import TeamOcular from "./pages/team/Ocular";
import TeamOverview from "./pages/team/Overview";
import TeamSources from "./pages/team/Sources";
import TeamUrine from "./pages/team/Urine";
import TeamVestibular from "./pages/team/Vestibular";
import TeamVitals from "./pages/team/Vitals";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LangProvider>
      <AppProvider>
        <BrowserRouter>
          <Routes>
            <Route index element={<Portal />} />
            <Route path="crew" element={<CrewLayout />}>
              <Route index element={<CrewToday />} />
              <Route path="ocular" element={<CrewOcular />} />
              <Route path="exercise" element={<CrewExercise />} />
              <Route path="energy" element={<CrewEnergy />} />
              <Route path="body" element={<CrewBody />} />
              <Route path="food" element={<CrewFood />} />
              <Route path="mind" element={<CrewMind />} />
              <Route path="return" element={<CrewReturn />} />
              <Route path="alerts" element={<AlertsPage side="crew" />} />
              <Route path="*" element={<Navigate to="/crew" replace />} />
            </Route>
            <Route path="team" element={<TeamLayout />}>
              <Route index element={<TeamOverview />} />
              <Route path="ocular" element={<TeamOcular />} />
              <Route path="alerts" element={<AlertsPage side="ground" />} />
              <Route path="vitals" element={<TeamVitals />} />
              <Route path="exercise" element={<TeamExerciseEnergy />} />
              <Route path="urine" element={<TeamUrine />} />
              <Route path="nutrition" element={<TeamNutrition />} />
              <Route path="mind" element={<TeamMind />} />
              <Route path="vestibular" element={<TeamVestibular />} />
              <Route path="lsah" element={<TeamLsah />} />
              <Route path="environment" element={<TeamEnvironment />} />
              <Route path="devices" element={<TeamDevices />} />
              <Route path="sources" element={<TeamSources />} />
              <Route path="*" element={<Navigate to="/team" replace />} />
            </Route>
            {/* old addresses from v1.0.0 */}
            <Route path="surgeon" element={<Navigate to="/team" replace />} />
            <Route path="lab" element={<Navigate to="/team/urine" replace />} />
            <Route path="devices" element={<Navigate to="/team/devices" replace />} />
            <Route path="sources" element={<Navigate to="/team/sources" replace />} />
            <Route path="environment" element={<Navigate to="/team/environment" replace />} />
            <Route path="nutrition" element={<Navigate to="/crew/food" replace />} />
            <Route path=":page" element={<LegacyCrew />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AppProvider>
    </LangProvider>
  </React.StrictMode>,
);

function LegacyCrew() {
  const page = location.pathname.replace(/^\//, "");
  return <Navigate to={["exercise", "body", "alerts"].includes(page) ? `/crew/${page}` : "/"} replace />;
}
