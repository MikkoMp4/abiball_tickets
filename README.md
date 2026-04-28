# abiball_tickets

Github Repo zum halb-automatisieren vom Verkauf der Abiball Tickets!

## Features

| Feature | Beschreibung |
|---|---|
| Zugangscodes generieren | Automatisches Generieren von Zugangscodes für beliebig viele Personen mit konfigurierbarer Ticketanzahl und Namen |
| Export | Codes als CSV oder Excel-Datei exportieren |
| Code-Interface | Einfache Weboberfläche zur Eingabe des persönlichen Zugangscodes |
| Ticket-Bestellung | Pro Person: Anzahl Tickets, Preis, Formular für jedes Ticket (Name, Klasse, …) |
| EPC/Girocode | Automatische Generierung von EPC-QR-Codes für vorgefertigte Überweisungen (Banking-App-kompatibel) |
| Kontoauszug-Prüfung | Hochladen eines CSV-Kontoauszugs → automatischer Abgleich mit offenen Bestellungen |
| Ticket-QR-Codes | Nach bestätigter Zahlung: QR-Code-Tickets automatisch per E-Mail versenden |

## Screenshots

### Startseite – Zugangscode eingeben
![Startseite](<img width="2032" height="1108" alt="image" src="https://github.com/user-attachments/assets/59fccecd-a15e-4240-8159-83b9223cf7b8" />
)

## Setup

### Voraussetzungen

- Node.js ≥ 18
- npm

### Installation

```bash
git clone https://github.com/MikkoMp4/abiball_tickets.git
cd abiball_tickets
npm install
```

### Konfiguration

Kopiere die Beispiel-Konfiguration und passe sie an:

```bash
cp .env.example .env
```

Wichtige Einstellungen in `.env`:

```
# SMTP-Konfiguration für den E-Mail-Versand
SMTP_HOST=smtp.gmail.com
SMTP_USER=dein@email.de
SMTP_PASS=geheimes_passwort

# Bankdaten für EPC/Girocode-Generierung
BANK_IBAN=DE00 1234 5678 9012 3456 78
BANK_NAME=Abiball-Komitee e.V.

# Ticket-Preis in Euro
TICKET_PRICE=45
```

### Starten

```bash
# Produktion
npm start

# Entwicklung (mit automatischem Neustart)
npm run dev
```

Der Server läuft dann unter: **http://localhost:3000**

## Projektstruktur

```
├── server.js               # Express-Hauptserver
├── src/
│   ├── database.js         # SQLite-Datenbank & Schema
│   ├── routes/
│   │   ├── admin.js        # Admin-Endpunkte (Codegenerierung, Export)
│   │   ├── codes.js        # Code-Verifikation
│   │   ├── tickets.js      # Bestellprozess & EPC-QR
│   │   └── payments.js     # Kontoauszug-Upload & Ticket-E-Mail
│   └── utils/
│       ├── codeGenerator.js # Zufällige Zugangscodes
│       ├── epcGenerator.js  # EPC/Girocode-Format
│       ├── qrGenerator.js   # QR-Code-Bilder
│       ├── bankParser.js    # CSV-Kontoauszug-Parser
│       └── emailSender.js   # nodemailer E-Mail-Versand
└── public/
    ├── index.html          # Startseite (Code-Eingabe)
    ├── order.html          # Bestellformular
    ├── admin.html          # Admin-Dashboard
    ├── css/style.css
    └── js/
        ├── main.js
        ├── order.js
        └── admin.js
```

## API-Endpunkte

| Method | Endpoint | Beschreibung |
|---|---|---|
| `POST` | `/api/admin/generate-codes` | Zugangscodes für Personen-Array generieren |
| `GET`  | `/api/admin/persons` | Alle Personen abrufen |
| `DELETE` | `/api/admin/persons/:id` | Person löschen |
| `GET`  | `/api/admin/export/csv` | Codes als CSV herunterladen |
| `GET`  | `/api/admin/export/excel` | Codes als Excel herunterladen |
| `POST` | `/api/codes/verify` | Zugangscode prüfen |
| `GET`  | `/api/tickets/config` | Ticket-Preis & Event-Daten |
| `POST` | `/api/tickets/order` | Bestellung absenden + EPC-QR erhalten |
| `POST` | `/api/payments/upload` | CSV-Kontoauszug hochladen & abgleichen |
| `GET`  | `/api/payments` | Alle Zahlungen auflisten |
| `POST` | `/api/payments/:id/send` | QR-Tickets per E-Mail senden |

