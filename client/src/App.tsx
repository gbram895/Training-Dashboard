import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import RequireAuth from './components/RequireAuth';
import NavShell from './components/NavShell';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import Plan from './pages/Plan';
import TodaysWorkoutDetail from './pages/TodaysWorkoutDetail';
import Workouts from './pages/Workouts';
import WorkoutForm from './pages/WorkoutForm';
import WorkoutDetail from './pages/WorkoutDetail';
import Goals from './pages/Goals';
import Settings from './pages/Settings';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
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
