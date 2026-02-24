import { stripCookieBannerText } from './src/lib/browseGateway.ts';

// Test the wp.pl legal disclaimer filtering
const wpContent = `
Wirtualna Polska - Wszystko co ważne - www.wp.pl

Zaloguj się do serwisu

Cenimy Twoją prywatność

Kliknij "AKCEPTUJĘ I PRZECHODZĘ DO SERWISU", aby wyrazić zgodę na korzystanie w Internecie z technologii automatycznego gromadzenia i wykorzystywania danych.

Pobieranie, zwielokrotnianie, przechowywanie lub jakiekolwiek inne wykorzystywanie treści dostępnych w niniejszym serwisie - bez względu na ich charakter i sposób wyrażenia (w szczególności lecz nie wyłącznie: słowne, słowno-muzyczne, muzyczne, audiowizualne, audialne, tekstowe, graficzne i zawarte w nich dane i informacje, bazy danych i zawarte w nich dane) oraz formę (np. literackie, publicystyczne, naukowe, kartograficzne, programy komputerowe, plastyczne, fotograficzne) wymaga uprzedniej i jednoznacznej zgody Wirtualna Polska Media Spółka Akcyjna z siedzibą w Warszawie, będącej właścicielem niniejszego serwisu, bez względu na sposób ich eksploracji i wykorzystaną metodę (manualną lub zautomatyzowaną technikę, w tym z użyciem programów uczenia maszynowego lub sztucznej inteligencji). Powyższe zastrzeżenie nie dotyczy wykorzystywania jedynie w celu ułatwienia ich wyszukiwania przez wyszukiwarki internetowe oraz korzystania w ramach stosunków umownych lub dozwolonego użytku określonego przez właściwe przepisy prawa.

Szczegółowa treść dotycząca niniejszego zastrzeżenia znajduje się tutaj.

To jest ważna treść artykułu, która powinna pozostać po filtrowaniu.
Strona korzysta z plików tekstowych zwanych ciasteczkami, aby zapewnić użytkownikom jak najlepszą obsługę.

Kolejny ważny akapit z informacjami dla użytkownika.
`;

console.log('=== ORIGINAL CONTENT ===');
console.log(wpContent);
console.log('\n=== FILTERED CONTENT ===');
console.log(stripCookieBannerText(wpContent));
console.log('\n=== CHECK ===');
const filtered = stripCookieBannerText(wpContent);
console.log('Contains legal disclaimer:', filtered.includes('Wirtualna Polska Media'));
console.log('Contains cookie banner:', filtered.includes('zwanych ciasteczkami'));
console.log('Contains important content:', filtered.includes('ważna treść artykułu'));
