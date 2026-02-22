projekt wymaga jeszce pracy, dlatego zapraszam do zgłaszania sugestii, 
finalnie chciałbym aby to działało jako aplikacja na jakimś android tablet/smartfon w celu szybkiego odpytania o coś z opcja podgladu, minimalizujac ilosc informacji.
będzie więcej endpointów, teraz mamy http, potem dodam API rest/ws , mqtt, kamery rstp z opisem sceny na kamerze, itd
mozliwosc skanowania urzadzen w sieci lokalnej
znajdywanie uslug dostepnych na nich
i jesli to kamera to mozliwosc odpytania
oraz tworzenia historii zmian na danym endpoincie, aby bot z chat  sygnalizowal automatycznie o zmianach stanu/tresci na danej stronie
nie wiem tylko jak stworzyc menu do zarzadzania,czy wystarczy w chat  stworzyc okno czasowe
np jesli bylo odpytywane w ciagu ostatniej godziny to bedzie informowalo o wszelkich zmianach w ciagu nastepnej godziny?

np. jesli dzis odpytywales o cos odnosnie kamery, bylo pytanie o to co dzieje sie na wybranej kamerze to przy zmianach
automatycznie uzytkownik bedzie informowany, ze tam sie cos zmienilo
jednoczesnie raz wykryte urzadzenie powinno pozostac do dyspoczcyji gdy bedzi eo nie pytanie
aby nie trzeba było na nowo skanowac calej sieci i inicjiowac konfiguracji, ewentualnie restu

dlatego lista stron, urzadzen powinna byc zapisywana do bazy sqlite
wszystkie wiadomosci chat w osobnej bazie danych



wyszukaj kamere w sieci lokalnej:
Oto najważniejsze sposoby i narzędzia, które pomogą Ci odnaleźć kamerę w sieci lokalnej:

Strona Dipol poleca darmową aplikację SADP. Jest to proste narzędzie służące do wyszukiwania w sieci lokalnej kamer i rejestratorów marki Hikvision. Pozwala ono także na zmianę hasła czy edycję parametrów sieciowych.

Serwis Kompletny Przewodnik wyjaśnia, że podstawą jest poznanie adresu IP kamery. Można to zrobić za pomocą wiersza poleceń w systemie Windows, wpisując komendę arp -a. Wyświetli ona listę wszystkich urządzeń podłączonych do sieci wraz z ich adresami fizycznymi.

Portal Overmax opisuje narzędzie SearchPro Tool. Po podłączeniu kamery do routera i uruchomieniu tego programu wystarczy kliknąć przycisk wyszukiwania, aby na ekranie pojawił się dokładny adres IP urządzenia.

Firma Kenik w swojej instrukcji wskazuje na program Device Manager. Przypomina również, że wiele kamer ma ustawiony domyślny adres, na przykład 192.168.1.100, który warto sprawdzić w pierwszej kolejności.

Eksperci ze strony Digitaldep zaznaczają, że samo znalezienie kamery w sieci lokalnej to pierwszy krok. Jeśli chcesz mieć do niej dostęp spoza domu, konieczna będzie dodatkowa konfiguracja przekierowania portów na routerze.

Witryna IPOX podkreśla, że producenci często dostarczają dedykowane oprogramowanie wspierające użytkownika, które automatyzuje proces wykrywania sprzętu i pomaga uniknąć konfliktów adresów w sieci.
URL: https://html.duckduckgo.com/html/?q=wyszukaj%20kamere%20w%20sieci%20lokalnej