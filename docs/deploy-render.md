# Deploying to Render

`render.yaml` deploys Qnetward to [Render](https://render.com) as one Docker
web service: the Go API, the Next.js console, and nginx in front of both
(`deploy/render/`), plus a free Render Postgres database.

This setup is for testing and demos. Read the limits below before showing it
to customers.

## Limits of the free plan

- **It sleeps.** A free service stops after about 15 minutes without traffic
  and takes 30 to 60 seconds to wake on the next visit. While it sleeps,
  monitors don't run and no alerts go out.
- **ICMP may not work.** Ping and traceroute need raw sockets. The container
  runs as root, so they work if Render keeps the `NET_RAW` capability; if it
  doesn't, those two tools show an error. TCP ping, DNS, port scans, HTTP
  monitors, and everything else work either way.
- **Small machine.** About 512 MB of memory and a fraction of a CPU.
- **Monthly hours.** Free services share 750 hours a month per account, enough
  for one service running all month.
- **The database is temporary.** A free Render Postgres database expires 30
  days after it's created and is deleted, with all its data, 14 days after
  that. It has no backups and 1 GB of storage. For anything longer, upgrade it
  or point `QNETWARD_DB_DSN` at another database such as Neon.
- **Database roles.** Migrations create a `qnetward_tenant` role for
  row-level security, which needs the database user to be allowed to create
  roles. If the first deploy's log shows `permission denied to create role`,
  Render's user lacks that right; use an external database instead.

To keep it awake, have a free scheduler such as cron-job.org or UptimeRobot
request `https://<your-service>.onrender.com/healthz` every 10 minutes. Render
discourages this on the free plan; a paid instance doesn't sleep.

## Setup

1. **Database.** Nothing to do: the Blueprint creates `qnetward-db` and wires
   its connection string into the service. Migrations run on startup.
2. **Encryption key.** Generate one and keep it; changing it later makes
   stored secrets (two-factor seeds, alert channel URLs) unreadable:

   ```sh
   openssl rand -base64 32
   ```

3. **Create the service.** In Render: New → Blueprint → connect the GitHub
   repository → Render reads `render.yaml`. It asks for the values marked
   `sync: false`:

   | Variable | Value |
   |---|---|
   | `QNETWARD_ENCRYPTION_KEY` | The key from step 2 |
   | `QNETWARD_PUBLIC_BASE_URL` | `https://<service>.onrender.com`, or your domain |
   | `QNETWARD_RESEND_API_KEY` | Optional; without it no email is sent |
   | `QNETWARD_EMAIL_FROM` | Optional, such as `Qnetward <no-reply@your-domain>` |
   | `QNETWARD_ADMIN_EMAILS` | Your email, for the admin pages |

   Leave a value empty if you don't have it yet; set it later under the
   service's Environment tab, which redeploys.

4. **Wait for the first build.** It builds the Go binary and the console,
   about 5 to 10 minutes. Then open the service URL and try the demo.

5. **Custom domain (optional).** Under Settings → Custom Domains, add for
   example `app.qnetward.com`, create the DNS record Render shows, and set
   `QNETWARD_PUBLIC_BASE_URL` to the new address.

Every push to `main` redeploys. CI builds the same image, so a change that
breaks the deploy shows up there first.

## Notes

- The shared demo is on and restricted: visitors can look around but can't
  publish status pages, add agents, or change billing. Don't set
  `QNETWARD_DEMO_FULL_ACCESS` on a public deployment.
- Google sign-in needs `QNETWARD_GOOGLE_CLIENT_ID` and
  `QNETWARD_GOOGLE_CLIENT_SECRET`, with
  `<QNETWARD_PUBLIC_BASE_URL>/api/auth/google/callback` registered at Google.
- Payments need `QNETWARD_UDDOKTAPAY_URL` and `QNETWARD_UDDOKTAPAY_API_KEY`.
