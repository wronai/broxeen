/**
 * Intent Router - detects user intent and routes to appropriate plugin
 */

import type { IntentDetection, IntentRouter as IIntentRouter, Plugin, PluginContext, DataSourcePlugin } from './types';
import { scopeRegistry } from '../plugins/scope/scopeRegistry';
import { classifyIntent, type LlmIntentResult } from './llmIntentClassifier';

export class IntentRouter implements IIntentRouter {
  private intentPatterns = new Map<string, RegExp[]>();
  private plugins = new Map<string, Plugin>();
  private dataSourcePlugins = new Map<string, DataSourcePlugin>();
  private useLlmClassifier: boolean;

  constructor(options?: { useLlmClassifier?: boolean }) {
    this.useLlmClassifier = options?.useLlmClassifier ?? false;
    this.initializeDefaultPatterns();
  }

  private initializeDefaultPatterns(): void {
    // Camera live preview intents (checked first so specific IPs aren't caught by network scan)
    this.intentPatterns.set('camera:live', [
      /^rtsp:\/\//i,
      /pokaż.*live|pokaz.*live/i,
      /live.*preview/i,
      /podgląd.*live|podglad.*live/i,
      /pokaż\s+kamer[ęe]\s+\d{1,3}\.\d{1,3}\./i,
      /pokaz\s+kamer[ęe]\s+\d{1,3}\.\d{1,3}\./i,
    ]);

    // HTTP/Browse intents
    this.intentPatterns.set('browse:url', [
      /https?:\/\/[^\s]+/i,
      /^(www\.)?[a-z0-9-]+\.[a-z]{2,}/i,
    ]);

    // Network discovery intents (checked before camera:describe)
    this.intentPatterns.set('network:scan', [
      /skanuj.*sieć/i,
      /skanuj.*siec/i,
      /odkryj.*urządzenia/i,
      /odkryj.*urzadzenia/i,
      /znajdź.*urządzenia/i,
      /znajdz.*urzadzenia/i,
      /scan.*network/i,
      /pokaż.*kamer/i,
      /pokaz.*kamer/i,
      /znajdź.*kamer/i,
      /znajdz.*kamer/i,
      /odnajdź.*kamer/i,
      /odnajdz.*kamer/i,
      /wyszukaj.*kamer/i,
      /wykryj.*kamer/i,
      /kamer.*w.*sieci/i,
      /kamer.*lan/i,
      /discover.*camera/i,
      /find.*camera/i,
    ]);

    // Camera describe intents (specific camera view, not discovery)
    this.intentPatterns.set('camera:describe', [
      /co.*wida.*na.*kamerze/i,
      /co.*widocz.*na.*kamerze/i,
      /co.*widac.*na.*kamerze/i,
      /co.*się.*dzieje.*na.*kamerze/i,
      /co.*sie.*dzieje.*na.*kamerze/i,
      /pokaż.*kamerę/i,
      /pokaz.*kamera/i,
      /kamera.*wejściow/i,
      /kamera.*ogrod/i,
      /co.*dzieje.*się.*na.*kamerze/i,
    ]);

    // Network ping intents
    this.intentPatterns.set('network:ping', [
      /ping\s/i,
      /^ping$/i,
      /sprawdź.*host/i,
      /sprawdz.*host/i,
      /sprawdź.*dostępność/i,
      /sprawdz.*dostepnosc/i,
      /czy.*odpowiada/i,
      /czy.*działa.*host/i,
      /czy.*dziala.*host/i,
      /czy.*jest.*dostępny/i,
      /czy.*jest.*dostepny/i,
      /check.*host/i,
      /reachable/i,
    ]);

    // Port scan intents
    this.intentPatterns.set('network:port-scan', [
      /skanuj.*port/i,
      /otwarte.*port/i,
      /sprawdź.*port/i,
      /sprawdz.*port/i,
      /scan.*port/i,
      /open.*port/i,
      /jakie.*porty/i,
    ]);

    // ARP intents
    this.intentPatterns.set('network:arp', [
      /tablica.*arp/i,
      /arp.*tablica/i,
      /arp.*table/i,
      /arp.*scan/i,
      /skanuj.*lan/i,
      /scan.*lan/i,
      /adresy.*mac/i,
      /mac.*address/i,
      /kto.*jest.*w.*sieci/i,
      /kto.*w.*sieci/i,
      /lista.*urządzeń/i,
      /lista.*urzadzen/i,
      /wszystkie.*urządzenia/i,
      /wszystkie.*urzadzenia/i,
      /hosty.*w.*sieci/i,
      /pokaż.*urządzenia.*mac/i,
      /pokaz.*urzadzenia.*mac/i,
    ]);

    // Wake-on-LAN intents
    this.intentPatterns.set('network:wol', [
      /wake.*on.*lan/i,
      /wol\s/i,
      /obudź.*urządzenie/i,
      /obudz.*urzadzenie/i,
      /włącz.*komputer/i,
      /wlacz.*komputer/i,
      /wybudź/i,
      /wybudz/i,
    ]);

    // mDNS intents
    this.intentPatterns.set('network:mdns', [
      /mdns/i,
      /bonjour/i,
      /zeroconf/i,
      /avahi/i,
      /odkryj.*usługi/i,
      /odkryj.*uslugi/i,
      /discover.*services/i,
      /znajdź.*usługi/i,
      /znajdz.*uslugi/i,
      /usługi.*lokalne/i,
      /uslugi.*lokalne/i,
      /local.*services/i,
      /urządzenia.*w.*sieci/i,
      /urzadzenia.*w.*sieci/i,
    ]);

    // ONVIF camera discovery intents
    this.intentPatterns.set('camera:onvif', [
      /onvif/i,
      /odkryj.*kamer/i,
      /wykryj.*kamer/i,
      /wyszukaj.*kamer.*ip/i,
      /kamery.*ip/i,
      /ip.*camera/i,
      /discover.*camera/i,
      /find.*camera/i,
    ]);

    // Camera health/status intents
    this.intentPatterns.set('camera:health', [
      /status.*kamer/i,
      /stan.*kamer/i,
      /zdrowie.*kamer/i,
      /health.*camera/i,
      /czy.*kamer.*działa/i,
      /czy.*kamer.*dziala/i,
      /sprawdź.*kamer/i,
      /sprawdz.*kamer/i,
    ]);

    // Camera PTZ intents
    this.intentPatterns.set('camera:ptz', [
      /obróć.*kamer/i,
      /obroc.*kamer/i,
      /przesuń.*kamer/i,
      /przesun.*kamer/i,
      /zoom.*kamer/i,
      /przybliż/i,
      /przybliz/i,
      /kamer.*w.*lewo/i,
      /kamer.*w.*prawo/i,
      /kamer.*do.*góry/i,
      /kamer.*w.*dół/i,
      /ptz/i,
    ]);

    // Camera snapshot intents
    this.intentPatterns.set('camera:snapshot', [
      /zrób.*zdjęcie.*kamer/i,
      /zrob.*zdjecie.*kamer/i,
      /snapshot.*kamer/i,
      /capture.*camera/i,
      /zrzut.*kamer/i,
      /złap.*klatkę/i,
      /zlap.*klatke/i,
    ]);

    // Device configuration intents
    this.intentPatterns.set('device:add', [
      /dodaj.*kamer[ęe]/i,
      /dodaj.*urz[ąa]dzenie/i,
      /add.*camera/i,
      /add.*device/i,
      /now[aą].*kamer[aę]/i,
      /now[eę].*urz[ąa]dzenie/i,
    ]);

    this.intentPatterns.set('device:save', [
      /zapisz.*kamer[ęe]/i,
      /zapisz.*urz[ąa]dzenie/i,
      /save.*camera/i,
      /save.*device/i,
      /zachowaj.*kamer[ęe]/i,
      /zachowaj.*urz[ąa]dzenie/i,
    ]);

    this.intentPatterns.set('device:configure', [
      /konfiguruj.*kamer[ęe]/i,
      /konfiguruj.*urz[ąa]dzenie/i,
      /configure.*camera/i,
      /configure.*device/i,
      /ustaw.*kamer[ęe]/i,
      /ustaw.*urz[ąa]dzenie/i,
    ]);

    this.intentPatterns.set('device:list-configured', [
      /lista.*skonfigurowanych/i,
      /skonfigurowane.*urz[ąa]dzenia/i,
      /skonfigurowane.*kamery/i,
      /configured.*devices/i,
      /configured.*cameras/i,
      /moje.*urz[ąa]dzenia/i,
      /moje.*kamery/i,
    ]);

    // Monitor intents
    this.intentPatterns.set('monitor:start', [
      /monitoruj/i,
      /obserwuj/i,
      /śledź/i,
      /sledz/i,
      /\b(?:zachowaj|wybierz)\s+monitoring\s+cd_[a-z0-9_]+\b\s*[:.,;!?]?/i,
      /w[łl]ącz\s+monitor/i,
      /wlacz\s+monitor/i,
      /wy[łl]ącz\s+monitor/i,
      /wylacz\s+monitor/i,
      /stop.*monitor/i,
      /zatrzymaj.*monitor/i,
      /aktywne.*monitor/i,
      /lista.*monitor/i,
      /logi.*monitor/i,
      /historia.*zmian/i,
      /pokaż.*logi/i,
      /pokaz.*logi/i,
    ]);

    // Monitor config intents
    this.intentPatterns.set('monitor:config', [
      /zmien.*interwał/i,
      /zmień.*interwał/i,
      /zmien.*interwal/i,
      /zmień.*interwal/i,
      /ustaw.*próg/i,
      /ustaw.*prog/i,
      /ustaw.*interwał/i,
      /ustaw.*interwal/i,
    ]);

    this.intentPatterns.set('system:processes', [
      /^procesy\b/i,
      /^processes\b/i,
      /^stop\s+proces\b/i,
      /^stop\s+process\b/i,
      /^zatrzymaj\s+proces\b/i,
      /^zatrzymaj\s+process\b/i,
    ]);

    // Marketplace intents
    this.intentPatterns.set('marketplace:browse', [
      /marketplace/i,
      /plugin.*store/i,
      /zainstaluj.*plugin/i,
      /install.*plugin/i,
      /lista.*plugin/i,
      /dostępne.*plugin/i,
      /dostepne.*plugin/i,
      /szukaj.*plugin/i,
      /wyszukaj.*plugin/i,
      /odinstaluj.*plugin/i,
      /uninstall.*plugin/i,
      /usun.*plugin/i,
      /usuń.*plugin/i,
    ]);

    // Protocol Bridge intents
    this.intentPatterns.set('bridge:read', [
      /bridge.*mqtt/i,
      /bridge.*rest/i,
      /bridge.*api/i,
      /bridge.*ws\b/i,
      /bridge.*websocket/i,
      /bridge.*sse/i,
      /bridge.*graphql/i,
      /odczytaj.*mqtt/i,
      /odczytaj.*rest/i,
      /pobierz.*rest/i,
      /pobierz.*api/i,
      /mqtt.*text|mqtt.*tekst/i,
      /rest.*text|rest.*tekst/i,
      /mqtt.*głos|mqtt.*glos|mqtt.*voice/i,
      /rest.*głos|rest.*glos|rest.*voice/i,
      /websocket|web.?socket/i,
      /połącz.*ws|polacz.*ws/i,
      /\bsse\b|server.?sent/i,
      /nasłuchuj.*zdarze|nasluchuj.*zdarze/i,
      /graphql/i,
      /zapytaj.*api/i,
      /strumień.*danych|strumien.*danych/i,
    ]);

    this.intentPatterns.set('bridge:send', [
      /wyślij.*mqtt|wyslij.*mqtt/i,
      /wyślij.*rest|wyslij.*rest/i,
      /wyślij.*ws|wyslij.*ws/i,
      /wyślij.*websocket|wyslij.*websocket/i,
      /wyślij.*graphql|wyslij.*graphql/i,
      /opublikuj.*mqtt/i,
      /publish.*mqtt/i,
      /send.*mqtt/i,
      /send.*rest/i,
      /send.*ws\b/i,
      /send.*graphql/i,
      /post.*https?:\/\//i,
    ]);

    this.intentPatterns.set('bridge:add', [
      /dodaj.*bridge/i,
      /add.*bridge/i,
      /nowy.*bridge|new.*bridge/i,
      /konfiguruj.*bridge|configure.*bridge/i,
    ]);

    this.intentPatterns.set('bridge:remove', [
      /usuń.*bridge|usun.*bridge/i,
      /remove.*bridge/i,
      /delete.*bridge/i,
    ]);

    this.intentPatterns.set('bridge:list', [
      /lista.*bridge|list.*bridge/i,
      /bridge.*lista|bridge.*list/i,
      /pokaż.*bridge|pokaz.*bridge/i,
    ]);

    this.intentPatterns.set('bridge:status', [
      /bridge.*status|status.*bridge/i,
      /stan.*bridge|bridge.*stan/i,
      /most.*protokół|most.*protokol/i,
      /protokół.*most|protokol.*most/i,
    ]);

    // Frigate NVR intents
    this.intentPatterns.set('frigate:status', [
      /frigate.*status/i,
      /status.*frigate/i,
      /frigate.*stan/i,
      /stan.*frigate/i,
      /frigate.*info/i,
    ]);

    this.intentPatterns.set('frigate:start', [
      /frigate.*start/i,
      /uruchom.*frigate/i,
      /włącz.*frigate/i,
      /wlacz.*frigate/i,
      /start.*frigate/i,
    ]);

    this.intentPatterns.set('frigate:stop', [
      /frigate.*stop/i,
      /zatrzymaj.*frigate/i,
      /wyłącz.*frigate/i,
      /wylacz.*frigate/i,
      /stop.*frigate/i,
    ]);

    // Disk info intents
    // Note: avoid matching every query that merely contains the word "dysk",
    // otherwise file-search queries like "znajdź dokumenty ... na dysku" get misrouted.
    this.intentPatterns.set('disk:info', [
      /poka[żz]\s+dysk/i,
      /poka[żz]\s+dyski/i,
      /sprawd[źz]\s+dysk/i,
      /u[żz]ycie\s+dysku/i,
      /disk\s+usage/i,
      /disk\s+space/i,
      /disk\s+info/i,
      /partycj/i,
      /partition/i,
      /ile.*miejsca/i,
      /ile.*wolnego/i,
      /ile.*zajęte/i,
      /ile.*zajete/i,
      /wolne.*miejsce/i,
      /storage/i,
      /\bdf\b/i,
      /pojemność.*dysk/i,
      /pojemnosc.*dysk/i,
      /miejsce.*na.*dysku/i,
    ]);

    // SSH intents
    this.intentPatterns.set('ssh:execute', [
      /^ssh\s/i,
      /text2ssh/i,
      /wykonaj.*na.*\d{1,3}\.\d{1,3}/i,
      /run\s+on\s+\d{1,3}\.\d{1,3}/i,
      /połącz.*ssh/i,
      /polacz.*ssh/i,
      /ssh.*connect/i,
      /zdaln.*komend/i,
      /remote.*command/i,
      /sprawdź.*na.*\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/i,
      /sprawdz.*na.*\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/i,
    ]);

    this.intentPatterns.set('ssh:hosts', [
      /ssh.*host/i,
      /znane.*host/i,
      /known.*host/i,
      /^ssh$/i,
      /test.*ssh/i,
      /sprawdź.*ssh/i,
      /sprawdz.*ssh/i,
    ]);

    // IoT/MQTT intents
    this.intentPatterns.set('iot:read', [
      /jaka.*temperatura/i,
      /jaka.*wilgotność/i,
      /ile.*stopni/i,
      /czujnik/i,
      /sensor/i,
    ]);

    // File search intents
    this.intentPatterns.set('file:search', [
      /znajd[źz]\s*plik/i,
      /wyszukaj\s*plik/i,
      /szukaj\s*plik/i,
      /znajd[źz]\s*dokument/i,
      /wyszukaj\s*dokument/i,
      /szukaj\s*dokument/i,
      // Invoice-like queries without the word "plik/dokument"
      /znajd[źz]\s+faktur/i,
      /wyszukaj\s+faktur/i,
      /szukaj\s+faktur/i,
      /\bfv\b/i,
      /invoice/i,
      /rachun/i,
      /plik[iy]?\s+na\s+dysku/i,
      /dokument[yów]?\s+na\s+dysku/i,
      /plik[iy]?\s+w\s+folderze/i,
      /plik[iy]?\s+w\s+katalogu/i,
      /przeczytaj\s+plik/i,
      /odczytaj\s+plik/i,
      /co\s+jest\s+w\s+pliku/i,
      /co\s+zawiera\s+plik/i,
      /otw[óo]rz\s+plik/i,
      /poka[żz]\s+plik/i,
      /file\s*search/i,
      /find\s*file/i,
      /search\s*file/i,
      // Listing queries
      /lista\s+(?:wszystkich\s+)?plik[óo]?w/i,
      /wylistuj\s+plik/i,
      /poka[żz]\s+(mi\s+)?plik[iy]?\s+(w|na)/i,
      /co\s+(jest|mam|znajduje\s+się)\s+(w|na)\s+(folderze|katalogu|dysku)/i,
      /zawarto[śs][ćc]\s+(folderu|katalogu)/i,
      /(folder|katalog)\s+(usera|u[żz]ytkownika|domowy|home)/i,
      /plik[iy]?\s+(usera|u[żz]ytkownika)/i,
      /ls\s+(~|\/home|\/)$/i,
      /list\s+(files|directory|folder)/i,
      /przejrzyj\s+(pliki|folder|katalog)/i,
      /wy[śs]wietl\s+plik/i,
    ]);

    // Email intents
    this.intentPatterns.set('email:send', [
      /wy[śs]lij.*(?:plik|mail|email)/i,
      /prze[śs]lij.*(?:plik|mail|email)/i,
      /send.*(?:file|email|mail)/i,
      /mail.*plik/i,
    ]);

    this.intentPatterns.set('email:inbox', [
      /sprawdz?\s*(?:email|e-mail|poczt|skrzynk)/i,
      /odczytaj\s*(?:email|e-mail|poczt)/i,
      /co\s+w\s+(?:email|mailu|poczcie|skrzynce)/i,
      /nowe\s+(?:email|wiadom)/i,
      /inbox/i,
      /poczta/i,
      /skrzynk/i,
    ]);

    this.intentPatterns.set('email:config', [
      /konfiguruj\s*(?:email|e-mail|poczt)/i,
      /config.*email/i,
      /ustaw\s*(?:email|e-mail|poczt)/i,
      /testuj\s*(?:email|e-mail|poczt)/i,
      /email.*(?:co\s+\d+|interwa[łl]|polling)/i,
      /odpytuj.*co\s+\d+/i,
    ]);

    // Search intents (less specific, check after network/camera intents)
    this.intentPatterns.set('search:web', [
      /wyszukaj.*stronę/i,
      /wyszukaj.*w.*internecie/i,
      /wyszukaj\s+informacje/i,
      /wyszukaj\s+o\s/i,
      /znajdź.*w.*internecie/i,
      /szukaj.*w.*google/i,
      /poszukaj.*w.*internecie/i,
      /search.*for/i,
    ]);

    // Monitoring / detection DB query intents
    this.intentPatterns.set('monitoring:query', [
      // Polish: when did someone enter / last detection
      /o\s+kt[óo]rej.*(?:kto[śs]|osob|wszed|weszł|weszl)/i,
      /kiedy.*(?:kto[śs]|osob|wszed|weszł|weszl|ostatni)/i,
      /ostatni.*(?:wykryci|detekcj|ruch|osob|wej[śs]ci)/i,
      // Polish: how many people/cars
      /ile\s+(?:os[óo]b|ludzi|samochod|aut|rower|zwierz|wykry[ćc])/i,
      /policz.*(?:os[óo]b|ludzi|samochod|auto|wykry)/i,
      /liczba.*(?:os[óo]b|ludzi|samochod|auto|wykry)/i,
      // Polish: show detections / what happened
      /poka[żz].*(?:wykryci|detekcj|zdarzeni|histori|ostatni)/i,
      /wy[śs]wietl.*(?:wykryci|detekcj|zdarzeni|histori)/i,
      /co\s+(?:si[ęe]\s+)?(?:działo|wydarzył|wykryto|zarejestrow)/i,
      /co\s+(?:było|jest)\s+(?:na|w)\s+(?:kamer|monitor)/i,
      // Polish: statistics / summary
      /statystyk.*(?:wykry|detekcj|monitor|kamer)/i,
      /podsumow.*(?:wykry|detekcj|monitor|kamer|dzi[śs])/i,
      // Polish: which cameras / camera activity
      /aktywno[śs][ćc].*kamer/i,
      /kt[óo]r[ae]?\s+kamer.*(?:wykry|aktywn|najwęcej|najwięcej)/i,
      // Polish: time-based queries about monitoring
      /mi[ęe]dzy.*(?:godzin|:\d).*(?:wykry|detekcj|osob|ruch)/i,
      /(?:godzin|por[ae])\s+(?:aktywn|szczyto|peak)/i,
      // English equivalents
      /last\s+(?:detection|person|car|motion|event)/i,
      /how\s+many\s+(?:people|person|car|detection)/i,
      /show\s+(?:detection|event|monitoring|history)/i,
      /when\s+(?:did|was)\s+(?:someone|person|last)/i,
      /monitoring\s+(?:histor|stat|summar|event|log)/i,
      /detection\s+(?:histor|stat|summar|event|log)/i,
      // Direct DB query keywords
      /(?:baza|baz[ęe])\s+(?:dan|detekcj|wykry|monitor)/i,
      /przeszukaj.*(?:baz[ęe]|log|histori|detekcj)/i,
      /zapytaj.*(?:baz[ęe]|monitoring|detekcj)/i,
      /query\s+(?:db|database|detection|monitoring)/i,
    ]);

    // Camera live preview intents moved to top of file

    // Voice command intents
    this.intentPatterns.set('voice:command', [
      /wyłącz.*mikrofon/i,
      /włącz.*mikrofon/i,
      /mikrofon.*off/i,
      /mikrofon.*on/i,
      /zatrzymaj.*mikrofon/i,
      /stop.*mikrofon/i,
      /uruchom.*mikrofon/i,
      /start.*mikrofon/i,
      /wyłącz.*sterowanie.*głosowe/i,
      /włącz.*sterowanie.*głosowe/i,
      /sterowanie.*głosowe.*off/i,
      /sterowanie.*głosowe.*on/i,
      /zatrzymaj.*sterowanie.*głosowe/i,
      /stop.*sterowanie.*głosowe/i,
      /uruchom.*sterowanie.*głosowe/i,
      /start.*sterowanie.*głosowe/i,
    ]);

    // Logs management intents
    this.intentPatterns.set('logs:download', [
      /pobierz.*logi/i,
      /exportuj.*logi/i,
      /zapisz.*logi/i,
      /logi.*pobierz/i,
      /logi.*export/i,
      /logi.*zapisz/i,
      /pokaz.*logi/i,
      /pokaż.*logi/i,
      /drukuj.*logi/i,
    ]);

    this.intentPatterns.set('logs:clear', [
      /wyczyść.*logi/i,
      /usuń.*logi/i,
      /clear.*log/i,
      /wyczyść.*log/i,
      /usuń.*log/i,
      /czystość.*log/i,
    ]);

    this.intentPatterns.set('logs:level', [
      /poziom.*logów/i,
      /log.*level/i,
      /ustaw.*log/i,
      /sprawdź.*log/i,
      /status.*log/i,
      /poziom.*log/i,
    ]);

    // Chat/LLM intents (fallback)
    this.intentPatterns.set('chat:ask', [
      /.+/, // catch-all (non-empty)
    ]);
  }

  registerPlugin(plugin: Plugin): void {
    this.plugins.set(plugin.id, plugin);
  }

  registerDataSourcePlugin(plugin: DataSourcePlugin): void {
    this.dataSourcePlugins.set(plugin.id, plugin);
  }

  async detect(input: string): Promise<IntentDetection> {
    const normalizedInput = input.toLowerCase().trim();
    console.log(`🔍 Detecting intent for input: "${input}"`);

    // Try deterministic regex patterns first (free, instant)
    console.log(`🔄 Using regex-based intent detection for: "${normalizedInput}"`);
    for (const [intent, patterns] of this.intentPatterns) {
      if (intent === 'chat:ask') continue; // skip fallback for now

      for (const pattern of patterns) {
        if (pattern.test(normalizedInput)) {
          console.log(`✅ Intent detected: ${intent} with pattern: ${pattern}`);
          return {
            intent,
            confidence: this.calculateConfidence(normalizedInput, intent),
            entities: this.extractEntities(normalizedInput, intent),
          };
        }
      }
    }

    // No regex match — try LLM classifier as a smarter fallback
    if (this.useLlmClassifier) {
      try {
        const llmResult = await classifyIntent(input);
        if (llmResult) {
          console.log(`✅ LLM Intent detected: ${llmResult.intent} (confidence: ${llmResult.confidence})`);
          return {
            intent: llmResult.intent,
            confidence: llmResult.confidence,
            entities: llmResult.entities,
          };
        }
      } catch (error) {
        console.warn(`⚠️ LLM intent classification failed:`, error);
      }
    }

    console.log(`⚠️ No specific intent matched, falling back to chat:ask`);
    // Fallback to chat
    return {
      intent: 'chat:ask',
      confidence: 0.5,
      entities: {},
    };
  }

  route(intent: string, scope?: string): Plugin | DataSourcePlugin | null {
    console.log(`🔍 Routing intent: "${intent}" with scope: "${scope || 'none'}"`);
    console.log(`📋 Available plugins: ${Array.from(this.plugins.keys()).join(', ')}`);
    console.log(`📋 Available intents: ${Array.from(this.plugins.values()).map(p => `${p.id}: [${p.supportedIntents?.join(', ')}]`).join(' | ')}`);

    // Check legacy plugins first
    for (const plugin of this.plugins.values()) {
      console.log(`🔍 Checking plugin: ${plugin.id}, supportedIntents: [${plugin.supportedIntents?.join(', ')}], includes: ${plugin.supportedIntents?.includes(intent)}`);
      if (!plugin.supportedIntents || !plugin.supportedIntents.includes(intent)) continue;
      if (scope && !scopeRegistry.isPluginAllowed(plugin.id, scope)) continue;
      console.log(`✅ Found plugin: ${plugin.id} for intent: ${intent}`);
      return plugin;
    }
    // Check DataSourcePlugins
    for (const plugin of this.dataSourcePlugins.values()) {
      if (!plugin.capabilities || !plugin.capabilities.intents || !plugin.capabilities.intents.includes(intent as any)) continue;
      if (scope && !scopeRegistry.isPluginAllowed(plugin.id, scope)) continue;
      return plugin;
    }
    return null;
  }

  private calculateConfidence(input: string, intent: string): number {
    // Simple confidence calculation based on keyword matches
    const keywordMap: Record<string, string[]> = {
      'browse:url': ['http', 'www', '.pl', '.com', '.org'],
      'camera:describe': ['kamera', 'wida', 'dzieje'],
      'camera:health': ['status', 'stan', 'sprawdź', 'kamera'],
      'camera:ptz': ['obróć', 'przesuń', 'zoom', 'ptz', 'lewo', 'prawo'],
      'camera:snapshot': ['zdjęcie', 'snapshot', 'zrzut', 'klatka'],
      'camera:onvif': ['onvif', 'odkryj', 'kamera'],
      'network:ping': ['ping', 'sprawdź', 'host'],
      'network:port-scan': ['port', 'skanuj', 'otwarte'],
      'network:arp': ['arp', 'mac', 'tablica'],
      'network:wol': ['wake', 'wol', 'obudź', 'wybudź'],
      'network:mdns': ['mdns', 'bonjour', 'usługi'],
      'marketplace:browse': ['marketplace', 'plugin', 'zainstaluj'],
      'iot:read': ['temperatura', 'wilgotność', 'czujnik', 'sensor'],
      'bridge:read': ['bridge', 'most', 'mqtt', 'rest', 'api', 'tekst', 'głos', 'websocket', 'sse', 'graphql', 'nasłuchuj', 'strumień'],
      'bridge:send': ['wyślij', 'mqtt', 'rest', 'publish', 'send', 'websocket', 'graphql'],
      'bridge:add': ['dodaj', 'bridge', 'konfiguruj'],
      'bridge:remove': ['usuń', 'bridge', 'remove'],
      'bridge:list': ['lista', 'bridge', 'pokaż'],
      'bridge:status': ['status', 'bridge', 'most', 'protokół'],
      'search:web': ['wyszukaj', 'znajdź', 'szukaj'],
      'file:search': ['plik', 'dokument', 'znajdź', 'wyszukaj', 'szukaj', 'folder', 'katalog', 'przeczytaj', 'odczytaj'],
      'email:send': ['wyślij', 'prześlij', 'mail', 'email', 'plik'],
      'email:inbox': ['skrzynk', 'inbox', 'poczta', 'email', 'wiadomoś'],
      'email:config': ['konfiguruj', 'email', 'ustaw', 'testuj', 'polling', 'interwał'],
      'disk:info': ['dysk', 'disk', 'partycj', 'miejsce', 'wolne', 'storage', 'df'],
      'ssh:execute': ['ssh', 'text2ssh', 'zdaln', 'wykonaj', 'połącz'],
      'ssh:hosts': ['ssh', 'hosty', 'known_hosts'],
    };

    const keywords = keywordMap[intent] || [];
    const matches = keywords.filter(keyword => input.includes(keyword)).length;

    // Base confidence + keyword bonus
    const baseConfidence = intent === 'chat:ask' ? 0.5 : 0.6;
    return Math.min(0.9, baseConfidence + (matches * 0.1));
  }

  private extractEntities(input: string, intent: string): Record<string, unknown> {
    const entities: Record<string, unknown> = {};

    switch (intent) {
      case 'browse:url':
        // Extract URL patterns
        const urlMatch = input.match(/(https?:\/\/[^\s]+|(www\.)?[a-z0-9-]+\.[a-z]{2,})/i);
        if (urlMatch) {
          entities.url = urlMatch[1];
        }
        break;

      case 'camera:describe':
        // Extract camera location/name
        if (input.includes('wejściow') || input.includes('front')) {
          entities.cameraId = 'cam-front';
        } else if (input.includes('ogród') || input.includes('ogrod')) {
          entities.cameraId = 'cam-garden';
        }
        break;

      case 'iot:read':
        // Extract sensor type
        if (input.includes('temperatura')) {
          entities.sensorType = 'temperature';
        } else if (input.includes('wilgotność')) {
          entities.sensorType = 'humidity';
        }
        break;

      case 'network:ping':
      case 'network:port-scan': {
        const ipTarget = input.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
        if (ipTarget) entities.target = ipTarget[0];
        break;
      }

      case 'network:wol': {
        const macAddr = input.match(/([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}/);
        if (macAddr) entities.mac = macAddr[0];
        break;
      }

      case 'disk:info': {
        const diskPath = input.match(/(?:ścieżk[aę]|path|katalog|folder)\s+(\S+)/i);
        if (diskPath) entities.path = diskPath[1];
        const diskHost = input.match(/(?:na|on|host)\s+(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/i);
        if (diskHost) entities.remoteHost = diskHost[1];
        break;
      }

      case 'ssh:execute':
      case 'ssh:hosts': {
        const sshIp = input.match(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/);
        if (sshIp) entities.host = sshIp[1];
        const sshUser = input.match(/(?:user|użytkownik|jako)\s+(\S+)/i);
        if (sshUser) entities.user = sshUser[1];
        break;
      }

      case 'camera:health':
      case 'camera:ptz':
      case 'camera:snapshot': {
        if (input.includes('wejściow') || input.includes('front') || input.includes('wejsc'))
          entities.cameraId = 'cam-front';
        else if (input.includes('ogród') || input.includes('ogrod') || input.includes('garden'))
          entities.cameraId = 'cam-garden';
        else if (input.includes('salon') || input.includes('living'))
          entities.cameraId = 'cam-salon';
        break;
      }
    }

    return entities;
  }
}

// Helper: Build a PluginQuery
export interface PluginQuery {
  intent: string;
  rawInput: string;
  resolvedTarget?: string;
  params?: Record<string, unknown>;
  metadata?: {
    timestamp: number;
    source: 'voice' | 'text' | 'api';
    locale: string;
  };
}

export function buildQuery(
  intent: string,
  rawInput: string,
  overrides: Partial<Omit<PluginQuery, 'intent' | 'rawInput'>> = {},
): PluginQuery {
  return {
    intent,
    rawInput,
    params: {},
    metadata: {
      timestamp: Date.now(),
      source: 'text',
      locale: 'pl-PL',
    },
    ...overrides,
  };
}
