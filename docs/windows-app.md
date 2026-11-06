# Windows app and offline sales

The shop PC keeps a SQLite database outside the program folder. A completed sale is written there first. The receipt prints from that copy. When the internet returns, the same sale is uploaded to Supabase once. Installing a newer version of the app does not delete that file.

The online database was not changed. No tables were reset.

## Where the data lives

Windows stores it at:

`%APPDATA%\VANO POS\data\pos.sqlite`

Backups are written to:

`%APPDATA%\VANO POS\backups`

A new backup is made when the app has been running and the last backup is older than 12 hours. The newest 14 backups are kept.

To restore: close the POS, copy a backup over `data\pos.sqlite`, then open the POS again. Do this only on the shop PC that owns that file.

## What still needs the internet

Sign in once while online. That visit saves the login on this PC and downloads products, prices, and payment methods. After that, the cashier can sell, print, and open the drawer with the Wi-Fi off.

Another computer cannot see a sale until this PC uploads it. The POS title bar shows Online, Offline, or Syncing, and how many sales are waiting.

If two registers sell the last piece while both are offline, both sales are kept. The upload reduces the shared stock as far as it can and marks the sale as a stock conflict. It does not create a second copy of the same sale.

## Run it in development

From the `pos` folder:

```
npm run dev
```

The local database is created on the first sale or the first catalog refresh. Sign in while online so the product list is saved.

## Build the Windows installer

Install the desktop tools once:

```
npm install --save-dev electron electron-builder electron-updater
```

Build a standalone server and the installer. This does not touch Supabase:

```
$env:VANO_STANDALONE="1"
npx prisma generate
npx next build
```

Copy the standalone server into `dist-server` the way Next prints it (`.next/standalone`), including `.next/static` and `public`, then:

```
npx electron-builder --win nsis
```

The installer is created under `release`. It adds a desktop shortcut named VANO POS. Put `electron/icon.ico` in place before building if you want a custom icon.

The shop PC also needs Node.js installed, because the window starts the Next.js server with Node. The database password stays in the server environment on that PC. It is not sent to the cashier's window.

Set these on the shop PC before the server starts. Electron's packaged start already sets `VANO_DESKTOP=1`.

- `DATABASE_URL` — Supabase pooler connection (server only)
- `DIRECT_URL` — Supabase direct connection (server only)
- `AUTH_SECRET` — existing login secret, if the app uses one
- `VANO_DATA_DIR` — optional. Set this only if the database should live somewhere other than `%APPDATA%\VANO POS`

Do not put a Supabase service-role key in the app. This project does not use one.

## Publish an update

1. Test the change on this computer.
2. Commit and push to GitHub.
3. Raise `version` in `package.json`.
4. Build the installer with the commands above.
5. Create a GitHub Release whose tag matches that version, and attach the installer and the generated `latest.yml`.

The installed app checks that release, downloads it in the background, and installs it the next time the program closes. It does not restart in the middle of a sale, and it does not replace `pos.sqlite`.

`electron-builder` is set to publish to GitHub. The repository owner and name in `package.json` must match the GitHub repo before the first release. Replace `YOUR_GITHUB_USER` and `YOUR_REPO`.
