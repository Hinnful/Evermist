# Evermist privacy policy

Evermist is a desktop app for showing D&D maps on a TV. It has no server and no account of its own, and it
collects nothing about you.

## What stays on your computer

Your maps, notes, monsters, fights, pictures and music live on your own computer. Nothing is sent anywhere
unless you turn on sync.

## Sync through Google Drive

Sync is off until you press **Connect to Google** in Settings and allow it in your own Google account.

- Evermist asks Google for one permission only, `drive.appdata`: a hidden folder in your Drive that belongs to
  Evermist. It cannot see, open or change any other file in your Drive.
- It stores your campaign there (maps, rooms, fog, notes, monsters, fights, pictures, the Campaign), so your
  other computers can fetch it. Music is not synced.
- The sign-in token stays on your computer, encrypted where your system allows it. It is never sent to anyone
  but Google.
- The files go straight from your computer to your own Drive. The Evermist developer never receives them and
  cannot see them.
- **Disconnect** in Settings stops sync on that computer. To remove the hidden folder, open
  [Google Drive settings → Manage apps](https://drive.google.com/drive/settings), find Evermist, choose
  **Delete hidden app data**, then **Disconnect from Drive**.

Evermist's use of information received from Google APIs adheres to the
[Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
including the Limited Use requirements.

## Other connections

- Evermist checks GitHub for a new version. That request carries no personal data.
- When you add music from a link or a monster from a web page, Evermist fetches that address and nothing else.
- **Connect to Claude** in Settings lets the Claude app on your own computer read and change your campaign. It
  talks to Evermist on your computer only; what Claude does with it is covered by Anthropic's own terms.

## Contact

Questions: open an issue at https://github.com/Hinnful/Evermist/issues.
