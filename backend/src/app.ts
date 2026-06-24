import { Pool } from 'pg';
import cors from 'cors';
import path from 'path';
import express from 'express';
import { getHandler } from './routes/get';
import { putHandler } from './routes/put';
import { postHandler } from './routes/post';
import { deleteHandler } from './routes/delete';

export function createAppGivenPool(pool: Pool) {
  const app = express();

  // Middleware
  app.use(cors());
  app.use(express.json());

  app.get('/api/:tableName', async (req, res) => getHandler(req, res, pool, null));
  app.post('/api/:tableName', async (req, res) => postHandler(req, res, pool));
  app.put('/api/:tableName', async (req, res) => putHandler(req, res, pool));
  app.delete('/api/:tableName', async (req, res) => deleteHandler(req, res, pool));

  // Serve static files from frontend dist
  app.use(express.static(path.join(__dirname, '../../frontend/dist')));

  // Catch-all handler: send back index.html for any non-API routes
  app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, '../../frontend/dist/index.html'));
  });

  return app;
}
