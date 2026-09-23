import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import RequireAuth from './components/RequireAuth';
import NavShell from './components/NavShell';
import PageFallback from './components/PageFallback';

const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Plan = lazy(() => import('./pages/Plan'));
const TodaysWorkoutDetail = lazy(() => import('./pages/TodaysWorkoutDetail'));
const Calendar = lazy(() => import('./pages/Calendar'));
const Workouts = lazy(() => import('./pages/Workouts'));
const WorkoutForm = lazy(() => import('./pages/WorkoutForm'));
const WorkoutDetail = lazy(() => import('./pages/WorkoutDetail'));
const Goals = lazy(() => import('./pages/Goals'));
const Settings = lazy(() => import('./pages/Settings'));

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route
            path="/login"
            element={
              <Suspense fallback={<PageFallback />}>
                <Login />
              </Suspense>
            }
          />
          <Route
            path="/register"
            element={
              <Suspense fallback={<PageFallback />}>
                <Register />
              </Suspense>
            }
          />
          <Route
            element={
              <RequireAuth>
                <NavShell />
              </RequireAuth>
            }
          >
            <Route path="/" element={<Dashboard />} />
            <Route path="/plan" element={<Plan />} />
            <Route path="/plan/today" element={<TodaysWorkoutDetail />} />
            <Route path="/plan/calendar" element={<Calendar />} />
            <Route path="/workouts" element={<Workouts />} />
            <Route path="/workouts/new" element={<WorkoutForm />} />
            <Route path="/workouts/:id" element={<WorkoutDetail />} />
            <Route path="/workouts/:id/edit" element={<WorkoutForm />} />
            <Route path="/goals" element={<Goals />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
