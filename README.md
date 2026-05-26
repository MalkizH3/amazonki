# Amazonki (GitHub Pages + Firebase)
https://gramywplanszowki.pl/storage/games/1171/files/amazonki-instrukcja.pdf

Prototyp gry online zgodny ze specyfikacją:
- 3-10 graczy
- 2 drużyny: Grabieżcy i Amazonki
- maks. 4 rundy
- mechanika klucza i losowego odkrywania kart
- widoczność kart per gracz
- drużyny losowane z puli ról przy starcie gry

## 1. Co jest zrobione

- Lobby z kodem pokoju (tworzenie/dołączanie)
- Synchronizacja stanu gry przez Cloud Firestore
- Rozkład kart zgodny z tabelą dla 3-10 graczy
- Losowanie drużyn z puli zależnej od liczby graczy
- Odkrywanie losowej karty wskazanego gracza przy przekazaniu klucza
- Automatyczne kończenie rund i przetasowanie nieodkrytych kart
- Warunki zwycięstwa zgodnie z dokumentem

### Pula drużyn (losowana przy starcie)

| Gracze | Amazonki | Grabieżcy |
|-------|----------|-----------|
| 3 | 2 | 2 |
| 4 | 2 | 3 |
| 5 | 2 | 3 |
| 6 | 2 | 4 |
| 7 | 3 | 5 |
| 8 | 3 | 6 |
| 9 | 3 | 6 |
| 10 | 4 | 7 |

Jeśli pula ról ma więcej kart niż liczba graczy, nadmiarowa rola pozostaje nieużyta.

## 2. Konfiguracja Firebase

1. Utwórz projekt w Firebase Console.
2. Włącz Authentication i metodę Anonymous.
3. Włącz Cloud Firestore (tryb produkcyjny lub testowy).
4. Skopiuj konfigurację web app z Firebase i wklej do pliku app.js w obiekcie FIREBASE_CONFIG.

## 3. Minimalne reguły Firestore (na start)

Wklej jako reguły Firestore:

```txt
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /rooms/{roomId} {
      allow read, write: if request.auth != null;
      match /players/{playerId} {
        allow read, write: if request.auth != null;
      }
    }
  }
}
```

To są reguły prototypowe. Do produkcji warto dodać dodatkową walidację pól i ról hosta.

## 4. Uruchomienie lokalne

Ponieważ to statyczna strona z modułami ES, użyj prostego serwera HTTP:

1. Otwórz terminal w folderze projektu.
2. Uruchom:

```powershell
npx serve .
```

3. Otwórz adres z terminala (zwykle http://localhost:3000).

## 5. Publikacja na GitHub Pages

1. Utwórz repozytorium i wypchnij pliki.
2. W ustawieniach repo:
   - Settings -> Pages
   - Source: Deploy from a branch
   - Branch: main (root)
3. Po publikacji aplikacja będzie działać jako statyczna strona, a backendem zostaje Firebase.

## 6. Struktura plików

- index.html - UI aplikacji
- styles.css - styl i responsywność
- app.js - logika gry + Firebase
- README.md - instrukcja uruchomienia

## 7. Uwaga o hostingu

GitHub Pages hostuje tylko frontend. Stan gry, synchronizacja i dane są w Firestore.
