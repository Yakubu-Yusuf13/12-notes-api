import app from './app.js';
import { config } from './config.js';

if (process.env.VERCEL !== '1') {
  app.listen(config.PORT, () => {
    console.log(`Notes API listening on port ${config.PORT}`);
  });
}

export default app;
