import { IntentRouter } from './src/core/intentRouter.ts';
import { MonitorPlugin } from './src/plugins/monitor/monitorPlugin.ts';

const router = new IntentRouter({ useLlmClassifier: false });
router.detect('ile osób było w pomieszczeniu w ostatnich 100 minutach').then(res => {
  console.log('Detected intent:', res);
});
