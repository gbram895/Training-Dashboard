import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import authRouter from './routes/auth.js';
import workoutsRouter from './routes/workouts.js';
import goalsRouter from './routes/goals.js';
import healthRouter from './routes/health.js';

const app = express();
const PORT = process.env.PORT ?? 4000;

app.use(cors());
app.use(express.json({ limit: '15mb' }));

app.get('/api/status', (_req, res) => res.json({ ok: true }));
app.use('/api/auth', authRouter);
app.use('/api/workouts', workoutsRouter);
app.use('/api/goals', goalsRouter);
app.use('/api/health', healthRouter);

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
