# abiball_tickets

Selbst gehostetes System zum Verwalten vom Abiball-Ticket-Verkauf. Zugangscodes generieren, Bestellungen annehmen, Zahlungen abgleichen und QR-Tickets automatisch per Mail verschicken.

## Was das macht

- Zugangscodes für Personen generieren (mit konfigurierbarer Ticketanzahl pro Person)
- Schüler können über ihren Code Tickets bestellen (Name + E-Mail pro Ticket)
- EPC/Girocode wird automatisch generiert, den man direkt in der Banking-App einscannen kann
- Split-Zahlung: jeder zahlt sein Ticket einzeln, kriegt seinen eigenen QR-Code
- Kontoauszug (CSV oder PDF) hochladen → System gleicht automatisch mit offenen Bestellungen ab
- Bei Zahlung: QR-Code-Tickets automatisch per Mail verschickt
- Admin-Panel zum Überblick behalten, manuell als bezahlt markieren (ganze Bestellung oder einzelne Tickets), Codes exportieren usw.
- Bestellungen im Admin sind kollabiert und lassen sich einzeln aufklappen damit es nicht zu unübersichtlich wird
- QR-Ticket-Validierung beim Einlass

## Screenshots

### Startseite
![Startseite](https://github.com/user-attachments/assets/a98a5765-28a1-4856-9b29-2551b404f223)

## Setup

### Voraussetzungen

- Node.js >= 18
- npm

Oder einfach Docker (empfohlen).

### Mit Docker (empfohlen)

```bash
docker compose up -d
```

Die Datenbank liegt dann in `./data/` auf dem Host.

### Ohne Docker

```bash
git clone https://github.com/MikkoMp4/abiball_tickets.git
cd abiball_tickets
npm install
```

### Konfiguration

```bash
cp .env.example .env
```

Dann `.env` anpassen. Die wichtigsten Sachen:

```
# SMTP für den E-Mail-Versand
SMTP_HOST=smtp.gmail.com
SMTP_USER=dein@email.de
SMTP_PASS=app_passwort
MAIL_FROM=Abiball <dein@email.de>

# Bankdaten für den EPC-QR-Code
BANK_IBAN=DE00 0000 0000 0000 0000 00
BANK_BIC=XXXXDEXX
BANK_NAME=Abiball-Komitee

# Ticketpreis
TICKET_PRICE=45

# Admin-Passwort
ADMIN_PASSWORD=sicherespasswort
DANGER_PASSWORD=nochsichereres

# Datenbankpfad (bei Docker automatisch gesetzt)
DATA_DIR=/app/data
```

Bankdaten und Event-Details können auch nachträglich im Admin-Panel gesetzt werden.

### Starten

```bash
# Produktion
npm start

# Entwicklung
npm run dev
```

Läuft dann auf http://localhost:3000

## Projektstruktur

```
.
|-- server.js                # Express-Hauptserver
|-- src/
|   |-- database.js          # SQLite-Schema + Migrations
|   |-- routes/
|   |   |-- admin.js         # Admin-Endpunkte
|   |   |-- auth.js          # Login/Logout/Session
|   |   |-- codes.js         # Code-Verifikation
|   |   |-- tickets.js       # Bestellprozess, Split-Zahlung, QR-Validierung
|   |   |-- payments.js      # Kontoauszug-Upload, Zahlungsabgleich
|   |   `-- settings.js      # Event- und Bank-Einstellungen
|   `-- utils/
|       |-- codeGenerator.js # Zugangscode-Generierung
|       |-- epcGenerator.js  # EPC/Girocode
|       |-- qrGenerator.js   # QR-Code-Bilder
|       |-- pdfParser.js     # PDF-Kontoauszug-Parser
|       |-- emailSender.js   # nodemailer
|       `-- bankParser.js    # CSV-Kontoauszug-Parser
`-- public/
    |-- index.html           # Startseite
    |-- order.html           # Bestellformular
    |-- admin.html           # Admin-Dashboard
    |-- css/style.css
    `-- js/
        |-- main.js
        |-- order.js
        `-- admin.js
```

## API-Endpunkte

| Method | Endpoint | Beschreibung |
|---|---|---|
| `POST` | `/api/admin/generate-codes` | Zugangscodes generieren |
| `GET` | `/api/admin/persons` | Alle Personen |
| `PATCH` | `/api/admin/persons/:id` | Person bearbeiten (Name, Ticketanzahl) |
| `DELETE` | `/api/admin/persons/:id` | Person löschen |
| `GET` | `/api/admin/orders` | Alle Bestellungen inkl. Tickets |
| `POST` | `/api/admin/orders/:id/mark-paid` | Bestellung komplett als bezahlt |
| `POST` | `/api/admin/orders/:orderId/ticket/:ticketId/mark-paid` | Einzelnes Ticket als bezahlt markieren |
| `DELETE` | `/api/admin/orders/:orderId/ticket/:ticketId` | Einzelnes Ticket löschen |
| `GET` | `/api/admin/stats` | Dashboard-Statistiken |
| `GET` | `/api/admin/export/csv` | Codes als CSV |
| `GET` | `/api/admin/export/excel` | Codes als Excel |
| `POST` | `/api/admin/upload-statement` | CSV-Kontoauszug hochladen |
| `POST` | `/api/admin/upload-pdf` | PDF-Kontoauszug hochladen |
| `GET` | `/api/admin/settings` | Einstellungen lesen |
| `POST` | `/api/admin/settings` | Einstellungen speichern |
| `DELETE` | `/api/admin/danger/person/:id` | Person + Daten unwiderruflich löschen |
| `DELETE` | `/api/admin/danger/order/:id` | Bestellung unwiderruflich löschen |
| `DELETE` | `/api/admin/danger/payment/:id` | Zahlung löschen + Status neu berechnen |
| `DELETE` | `/api/admin/danger/all` | Alle Daten löschen (Nuclear) |
| `POST` | `/api/codes/verify` | Code prüfen |
| `GET` | `/api/tickets/config` | Ticketpreis + Event-Daten |
| `POST` | `/api/tickets/order` | Bestellung absenden |
| `GET` | `/api/tickets/my-order?code=CODE` | Bestellung einsehen/verwalten |
| `POST` | `/api/tickets/order/:id/enable-split` | Split-Zahlung aktivieren |
| `POST` | `/api/tickets/validate` | QR-Token beim Einlass prüfen |
| `GET` | `/api/payments` | Zahlungen auflisten |
| `POST` | `/api/payments/:id/send` | Tickets manuell per Mail senden |
