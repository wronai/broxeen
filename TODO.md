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