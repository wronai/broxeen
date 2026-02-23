import { MonitorPlugin } from './src/plugins/monitor/monitorPlugin';

const plugin = new MonitorPlugin();
async function main() {
  const can = await plugin.canHandle('ile osób było w pomieszczeniu w ostatnich 100 minutach', {} as any);
  console.log('Can handle:', can);
}
main();
