# Email to Trilium

Multi-account email inbox for TriliumNext Notes. Connect one or more **Gmail** or
**Microsoft (Outlook / Office 365)** accounts, browse recent messages in a render view, and:

- **Create Note** — turn an email into a note (subject as title, HTML body as content,
  attachments saved as Trilium attachments) filed under a per-account target note.
- **Delete** — trash the email in the mail account.

## How it works

The addon is a render widget (`view.jsx`) backed by a backend `customRequestHandler`
(`custom/emailToTrilium`) that talks to the Gmail API and Microsoft Graph over plain HTTPS.
Account configuration (including per-account "file under" note and OAuth credentials) is a
`libsettings@beatlink` schema-driven settings page.

Trilium backend notes cannot `require()` npm IMAP libraries, so this addon uses the providers'
HTTP APIs rather than raw IMAP. That covers Gmail and Outlook/Office 365; generic IMAP-only
hosts are not supported.

## Setup

Each account needs an OAuth app you register with the provider. The **redirect URI** for both is
this exact endpoint (shown in the Settings page for your instance):

```
<your-trilium-origin>/custom/emailToTrilium?action=callback
```

For a local desktop instance that's typically `http://127.0.0.1:8080/custom/emailToTrilium?action=callback`.

### Gmail

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project and enable the
   **Gmail API**.
2. Configure the OAuth consent screen (add your address as a test user), then create an
   **OAuth client ID** of type **Web application**.
3. Add the redirect URI above as an **Authorized redirect URI**.
4. Copy the **Client ID** and **Client Secret** into the account entry in Settings.

Scope used: `gmail.modify` (read messages and move them to trash).

### Microsoft (Outlook / Office 365)

1. In the [Azure portal](https://portal.azure.com/) → **App registrations**, register a new app.
2. Under **Authentication**, add a **Web** redirect URI matching the one above.
3. Under **Certificates & secrets**, create a client secret.
4. Under **API permissions**, add delegated Microsoft Graph permissions
   **Mail.ReadWrite** and **offline_access**.
5. Copy the **Application (client) ID** and secret into the account entry. Set **Azure Tenant** to
   `common` for personal/multi-tenant, or your specific tenant ID.

Scope used: `Mail.ReadWrite offline_access`.

## Usage

1. Open the addon's **Settings** and add an account: name, provider, client ID/secret, and the
   note to file emails under. Save.
2. Open the **Email to Trilium** render note. Select the account and click **Connect** — a consent
   window opens; authorize it, then reload the note.
3. The inbox lists recent messages. Use **Create Note** or **Delete** on any of them.

The **General** settings tab controls how many messages are listed per account and whether creating
a note also trashes the source email.

## Security notes

- OAuth **client secrets and refresh tokens are stored in Trilium notes** (the addon's `config.json`,
  a persistent note under the addon's `persistenceRoot`). This is appropriate for a personal instance; anyone with access to
  your Trilium database can read them. Refresh tokens are exchanged for short-lived access tokens on
  every request and access tokens are never stored.
- Clearing an account's **Refresh Token** field in Settings forces re-authorization.

## Dependencies

- [`libsettings@beatlink`](../libsettings@beatlink/) — settings schema/form + backend config I/O.
