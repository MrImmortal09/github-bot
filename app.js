import init from './src/index.js';
import startScheduler from './src/helper/scheduler.js';

export default async (app) => {
  app.log.info("Yay, the app was loaded!");

  // Start the main logic of the app.
  init(app);

  // Start the scheduler.
  
  app.onAny(startScheduler(app))
};
