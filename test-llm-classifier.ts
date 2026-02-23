import { classifyIntent } from './src/core/llmIntentClassifier';

async function main() {
  const result = await classifyIntent('ile osób było w pomieszczeniu w ostatnich 100 minutach');
  console.log(result);
}
main();
