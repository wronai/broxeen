import { IntentRouter } from './src/core/intentRouter';

const router = new IntentRouter({ useLlmClassifier: false });
router.detect('ile osób było w pomieszczeniu w ostatnich 100 minutach').then(console.log);
