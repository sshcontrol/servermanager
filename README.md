# SSHCONTROL

FastAPI backend with JWT auth, role-based permissions, TOTP 2FA, PostgreSQL schema, and React frontend with admin/user dashboards. SSH key–based server access: per-user keys, per-server roles (root/user for Linux), and authorized_keys sync.

---

## Deploy on a Linux server (recommended)

The app is set up to run on Linux with **Docker** and **Docker Compose**. No Windows-specific steps.

1. **On the server**, install Docker and Docker Compose if needed:
   ```bash
   # Ubuntu/Debian
   sudo apt-get update && sudo apt-get install -y docker.io docker-compose-plugin
   sudo usermod -aG docker $USER
   # Log out and back in, or use sudo for docker below
   ```

2. **Clone and configure**
   ```bash
   git clone <your-repo-url> servermanager && cd servermanager
   cp .env.example .env
   ```
   Edit `.env` and set at least:
   - `SECRET_KEY` — a long random string (e.g. `openssl rand -hex 32`)
   - `PUBLIC_API_URL` — the URL targets will use to reach this API (e.g. `https://manager.yourdomain.com` or `http://YOUR_SERVER_IP:8000`).  
     This is used by the “Add server” deploy script; managed servers must be able to reach this URL.

3. **Start the stack**
   ```bash
   docker compose up -d
   ```
   This starts PostgreSQL, the backend (migrations run on startup), and the frontend (production build served by nginx).

4. **Create the admin user** (once) — required before anyone can log in. If you see "Invalid username or password", create the admin first:
   ```bash
   docker compose exec backend python -m scripts.create_admin --username admin --password YOUR_SECURE_PASSWORD --email admin@yourdomain.com
   ```
   Then log in with that **username** and password (you can use email instead of username too).

5. **Open the app** in a browser: `http://YOUR_SERVER_IP:3000/login` (or your domain if you put a reverse proxy in front).

**If you see "500 Internal Server Error" on login (or "localhost:8000/health is unreachable")**

The frontend at port 3000 sends `/api` requests to the backend on port 8000. If nothing is listening on 8000, you get connection errors (often shown as 500).

- **Using Docker:** Run `docker compose up -d`, then check `docker compose ps` — `backend` and `db` should be Up. Test from your machine: `curl http://localhost:8000/health` (should return `{"status":"ok"}`). If the backend container has exited, run `docker compose logs backend` to see why (e.g. DB connection, migrations).
- **Running backend yourself:** From the project root, start the stack so the backend is on 8000 (e.g. run the backend with `cd backend && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000`). Ensure PostgreSQL is running and `DATABASE_URL` (or `.env`) is set. Then open `http://localhost:8000/health` to confirm.

**If http://YOUR_SERVER_IP:3000 doesn’t load**

- **Firewall:** Open ports 3000 and 8000 on the server. Example (UFW on Ubuntu):
  ```bash
  sudo ufw allow 3000
  sudo ufw allow 8000
  sudo ufw reload
  sudo ufw status
  ```
- **Containers running:** `docker compose ps` — frontend and backend should be “Up”.
- **Frontend logs:** `docker compose logs frontend` — look for “Local: http://0.0.0.0:3000” and any errors.
- **Test from the server:** `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000` — should return 200. If it works locally but not from your browser, the firewall is blocking.

**If the login page is missing Sign in, Create account, or Google button (or shows an old UI)**

The frontend is built into the Docker image at build time. After pulling new code or making changes, you must rebuild the frontend image:

```bash
docker compose build --no-cache frontend
docker compose up -d frontend
```

Then hard-refresh your browser (Ctrl+Shift+R or Cmd+Shift+R) to bypass cache. The login page footer should show "Version 6" when up to date. The Google button appears only when the backend has Google OAuth configured (`GOOGLE_OAUTH_CLIENT_ID` in `.env`).

**Production tips**

- Put **Nginx Proxy Manager** (or nginx/Caddy) in front for SSL: proxy to frontend `:3000` (which proxies `/api` to backend internally).
- Set `PUBLIC_API_URL` to the public URL of the API (e.g. `https://manager.yourdomain.com`) so the “Add server” curl command works from managed servers.
- Use strong `POSTGRES_PASSWORD` and `SECRET_KEY`; keep `.env` out of version control.
- The frontend container serves a production build (nginx + static files). No dev server in production.

**Database cleanup**

To wipe all data (users, servers, groups, audit log, etc.) and leave an empty schema:

- **From the host:**  
  `cd backend && python clean_db.py`  
  You will be prompted to type `yes` to confirm. Requires `DATABASE_URL` (or `.env`) to be set.

- **With Docker:**  
  `docker compose exec backend python clean_db.py`  
  Run from the project root. Type `yes` when prompted.

After cleanup you must create an admin again (see step 4 above). The schema and migrations are unchanged; only table data is removed.

---

## Adding a server when SSHCONTROL runs in Docker

The deploy command must use an API URL that the **target server** (the machine you are adding) can reach. The Add server page gets this URL from the backend (`PUBLIC_API_URL` in `.env`). Follow these steps so registration works.

### 1. Set `PUBLIC_API_URL` before starting

In the **same** `.env` you use for `docker compose`:

- **Target server is the same machine as Docker (e.g. local Ubuntu):**  
  Use the URL that the host uses to reach the backend. Port 8000 is mapped to the host, so:
  ```env
  PUBLIC_API_URL=http://65.21.240.77:8000
  ```
  Then **restart** the stack so the backend reads it:
  ```bash
  docker compose down && docker compose up -d
  ```

- **Target server is another machine:**  
  Use the URL that the **other** machine will use to reach your manager (e.g. the manager’s IP or domain):
  ```env
  PUBLIC_API_URL=http://YOUR_MANAGER_IP:8000
  ```
  Replace `YOUR_MANAGER_IP` with the real IP or hostname. Restart the stack after changing `.env`.

### 2. Add the server

1. Log in as admin → **Server** → **Add server**.
2. Copy the **deploy command** (it will already use the correct API URL from step 1).
3. On the **target** Linux server (SSH or console), run the command **as root or with sudo**:
   ```bash
   curl -sSL "http://65.21.240.77:8000/api/servers/deploy/script?token=YOUR_TOKEN" | sudo bash
   ```
   (Your token and URL will be in the copied command.)
4. When it finishes, the server appears under **Server** → **Servers**.

**Confirming which users have access (on the target server):**

- **List of panel users with access (and their keys):**  
  ```bash
  sudo cat /etc/sshcontrol/users-keys.json
  ```
  This file is updated by cron every 5 minutes. It contains a `users` array; each entry has `username` (Linux login name) and `authorized_key_line`. To list only usernames:
  ```bash
  sudo cat /etc/sshcontrol/users-keys.json | jq -r '.users[].username'
  ```
  (If `jq` is not installed, the raw JSON is still readable.)

- **Linux accounts created for panel users:**  
  For each user in the list above, the sync script creates a system user and home directory. You can see them with:
  ```bash
  ls /home
  ```
  or
  ```bash
  getent passwd | grep -E "^[a-z0-9_]+"
  ```
  Each of those users can SSH as `username@target-server` with their panel SSH key only (no password).

- **SSHCONTROL config on the target:**  
  All deploy/sync state lives under `/etc/sshcontrol/`: `server_id`, `token`, `api_url`, `users-keys.json`, `managed-users`, and the sync scripts. Cron runs the sync every 5 minutes. When you revoke a user in the panel, the next sync clears their SSH access (empties `~/.ssh/authorized_keys`) and removes sudo if they had it. Their Linux account and home directory (files) are kept.  
  **If you previously deployed with `/etc/myservermanager`:** Re-run the deploy command on the target server to migrate to `/etc/sshcontrol`. You can then remove the old directory: `sudo rm -rf /etc/myservermanager`.

**User login (no password):** The deploy script creates a **Linux user** for each panel user you assign to the server (sync runs every 5 min). So when you grant access to a user, they can SSH as **their panel username** (e.g. `aram`) with their key only — no password. In PuTTY they must set the **username** to that name (lowercase) and load their **PPK** under Connection → SSH → Auth → Private key file. If the server was deployed **before** this feature, re-run the deploy command on the server once so it installs the user-sync script; then new users will get Linux accounts within 5 minutes.

**SSH 2FA (optional):** If a user has **2FA (TOTP) enabled** in the panel (Profile → Security → Setup TOTP), they will be prompted for their 6-digit verification code after key authentication when they SSH. The code is verified by the panel; the TOTP secret never leaves the panel. Users without 2FA connect with key-only as before. **Redeploy** servers to enable SSH 2FA (run the deploy command again). Note: 2FA requires an **interactive** SSH session; `scp` and `rsync` are not supported for 2FA users.

**PuTTY (Windows): if the PPK shows an error**

1. **Check Session settings:** Host = server IP or hostname, Port = 22, Connection type = SSH.
2. **Set the login username:** Under Connection → Data, set "Auto-login username" to your **panel username** (lowercase, e.g. `admin` or `aram`). This must match the Linux user on the server.
3. **Load the private key:** Connection → SSH → Auth → Private key file for authentication: click Browse and select your `.ppk` file. Then go back to Session, save the session if you want, and click Open.
4. **If PuTTY says "Unable to use key file" or "Key format too new":** Use the PEM key and convert it in PuTTYgen:
   - Download **PEM (OpenSSH)** from the panel (same page: "Download my SSH key" → PEM).
   - Open **PuTTYgen** (from the PuTTY suite). Click **Load**, change the file type to "All Files (*.*)", and select the downloaded `.pem` file.
   - In PuTTYgen, click **Save private key**. Choose a name (e.g. `mykey.ppk`) and save. Use this new `.ppk` in PuTTY as in step 3.
5. **If it still asks for a password:** The server may not have synced your user yet (sync runs every 5 min), or the username in PuTTY doesn’t match your panel username. Confirm your username in the panel (Profile or the server’s "Access" list) and use that exact username (lowercase) in PuTTY.

**"Server refused our key" (then asks for password)**

This means the server does not have your public key in `~/.ssh/authorized_keys` for user `aram`, or the key there doesn’t match the one you’re using in PuTTY. Check the following:

1. **Deploy script was run on this server**  
   You must have run the deploy command (from the panel: Add server → copy command → on **65.21.240.77** run `curl -sSL "http://.../api/servers/deploy/script?token=..." | sudo bash`). If you only added the server in the panel but never ran that command on 65.21.240.77, do it now. That installs the sync and creates Linux users.

2. **You (aram) are in this server’s Access list**  
   In the panel: **Servers** → click this server → **Access**. Your user **aram** must be listed with a role (Root or User). If not, an admin must add you.

3. **You have an SSH key in the panel**  
   Log in as aram → **Profile** → **SSH keys**. There must be a key (or generate one). The key you use in PuTTY must be the one from the panel: **Download my SSH key (PEM or PPK)** and use that file in PuTTY. If you use an old or different key, the server will refuse it.

4. **Sync behavior**  
   - **Docker:** By default `ENABLE_SSH_SYNC=false` — the backend does not SSH to targets. Sync is requested; the target's cron applies changes within ~1 min. Set `ENABLE_SSH_SYNC=true` in `.env` if the backend can SSH to targets.
   - **Same host:** If the target is the same machine as Docker, set the server's IP to `host.docker.internal` (Edit server → IP) so the backend can reach it for immediate sync.

5. **Force a sync on the target server**  
   On the target server (SSH as root or with sudo), run:
   ```bash
   sudo /etc/sshcontrol/sync-users.sh
   ```
   This fetches the latest user list and revokes access for removed users (clears their SSH keys; their account and files remain). If user creation fails, check `sudo tail /etc/sshcontrol/sync-users.log` for errors.
   Then check that your user and key exist:
   ```bash
   sudo cat /etc/sshcontrol/users-keys.json | grep -A1 aram
   ls -la /home/aram/.ssh/
   cat /home/aram/.ssh/authorized_keys
   ```
   If `aram` is not in `users-keys.json`, you’re not in the server’s Access list or you have no SSH key in the panel. If the file in `authorized_keys` doesn’t match the public key for the PPK you use in PuTTY, re-download the key from the panel and use that in PuTTY, then run `sync-users.sh` again and try logging in.

### 3. Same-machine: fix “Offline” and connection check

If SSHCONTROL and the target are on the **same** host (e.g. both on your Ubuntu box at 172.25.186.154), the connection check runs **from inside the backend container**. The container cannot use `localhost` or the host’s LAN IP for the check. Do this:

1. Open **Servers** → click the new server → **Edit & access**.
2. In **IP / host for connection check**, set **`host.docker.internal`** (recommended; the stack adds this so the container can reach the host).
3. Save. The status should turn **Online** if SSH (port 22) is open on the host.

If **host.docker.internal** doesn’t work (older Docker), try **`172.17.0.1`**. If that still shows Offline, see **Troubleshooting “Offline”** below.

### 4. Other machine

If the target is another machine, leave **IP / host for connection check** as-is (it’s filled from registration). If it still shows Offline, check that port 22 is open and reachable from the host where Docker runs.

### 5. Troubleshooting “Offline”

The app checks reachability by opening a TCP connection to the configured IP/host on **port 22** (SSH). If it still shows Offline after setting **host.docker.internal** or **172.17.0.1**:

- **SSH must be running** on the host: `sudo systemctl status ssh` (or `sshd`). It should listen on `0.0.0.0:22` or at least on the Docker bridge.
- **Firewall**: On the host, allow port 22 from the Docker network (e.g. from `172.17.0.0/16` or `172.18.0.0/16`). Example for UFW:  
  `sudo ufw allow from 172.17.0.0/16 to any port 22` then `sudo ufw reload`.
- **Correct gateway**: If **172.17.0.1** fails, your Compose network may use another gateway. From the host run:  
  `docker compose exec backend sh -c 'ip route | grep default'`  
  Use the gateway IP shown (e.g. **172.18.0.1**) in **IP / host for connection check**.

---

## How to start the service (local / Windows)

All commands below work in **Windows CMD** (Command Prompt) or on Linux/macOS. Run them from the project folder (e.g. `cd servermanager`).

---

### Option A: Docker (recommended)

1. **Create env file and start DB + backend**
   ```cmd
   copy .env.example .env
   docker compose up -d db backend
   ```
   The backend runs migrations on startup. Wait a few seconds for it to be ready.

2. **Create the admin user** (once)
   ```cmd
   docker compose exec backend python -m scripts.create_admin --username admin --password admin --email admin@65.21.240.77
   ```

3. **Generate the platform SSH key** (required before deploying servers)
   ```cmd
   docker compose exec backend python -m scripts.generate_platform_key
   ```
   Or via the UI: log in as admin → **Keys** → Platform SSH key → **Generate**.

4. **Start the frontend**
   - **In Docker:**  
     ```cmd
     docker compose up -d frontend
     ```
     If you see *Failed to resolve import "qrcode.react"*, install deps inside the container:
     ```cmd
     docker compose exec frontend npm install
     ```
     Then restart: `docker compose restart frontend`.
   - **On your machine (dev):** open a **second** CMD window, then:
     ```cmd
     cd frontend
     npm install
     npm run dev
     ```

5. **Open the app:** http://65.21.240.77:3000/login — log in with `admin` / `admin`.

---

### Option B: Without Docker (local Python + Node)

1. **PostgreSQL** must be running (local or remote). Create a database and note the connection URL.

2. **Backend** — in CMD from the project folder:
   ```cmd
   cd backend
   copy ..\.env.example .env
   ```
   Edit `.env` and set:
   ```env
   DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DATABASE_NAME
   ```
   Then:
   ```cmd
   pip install -r requirements.txt
   uvicorn app.main:app --reload
   ```
   Migrations run on startup. Open a **second** CMD window, go to the project folder, then:
   ```cmd
   cd backend
   python -m scripts.create_admin --username admin --password admin --email admin@65.21.240.77
   python -m scripts.generate_platform_key
   ```

3. **Frontend** — in a **third** CMD window from the project folder:
   ```cmd
   cd frontend
   npm install
   npm run dev
   ```
   (For production without Docker: `npm ci` then `npm run build`, then serve `dist/` with nginx.)

4. **Open:** http://65.21.240.77:3000/login — log in with `admin` / `admin`.

---

### Troubleshooting: Backend won't start

- **See the real error:** Run `docker compose logs backend` and check the last lines for the traceback.
- **`ModuleNotFoundError: No module named 'psycopg2'`:** Rebuild the backend image so dependencies (including `psycopg2-binary`) are installed:  
  `docker compose build --no-cache backend`  
  Then `docker compose up -d backend`.
- **`Can't locate revision identified by '007'` (or another missing revision):** The database’s migration history doesn’t match the code (e.g. an old or copied DB). Set the stored revision to match the latest in code (e.g. `006`) and restart:
  ```cmd
  docker compose exec db psql -U servermanager -d servermanager -c "UPDATE alembic_version SET version_num = '006';"
  docker compose restart backend
  ```
  Use the revision id that is the **head** in `backend/alembic/versions/` (e.g. `006_audit_log.py` → `006`).

---

## Seeing UI changes (Create user, QR code for 2FA)

- **Create user and roles:** Log in as **admin**, then click **Users** in the top nav (or open http://65.21.240.77:3000/admin/users). You should see a **Create user** button; click it to open the form (email, username, password, role checkboxes). **Edit roles** is in each row.
- **QR code for 2FA:** Log in, click **Profile**, then **Setup TOTP**. After the setup request, the page shows a **QR code** and the secret. Scan the QR with an authenticator app, then enter the 6-digit code to enable 2FA.
- **If you don’t see the new UI:**  
  1. Install frontend deps: `cd frontend` then `npm install`.  
  2. If the frontend runs in Docker, rebuild and restart: `docker compose build frontend` then `docker compose up -d frontend`.  
  3. Hard-refresh the browser (Ctrl+Shift+R or Ctrl+F5) so the new bundle loads.

---

## Stack

- **Backend:** FastAPI, SQLAlchemy 2 (async), PostgreSQL, JWT, PyOTP (TOTP 2FA), Paramiko (SSH)
- **Frontend:** React 18, TypeScript, Vite, React Router

### Production requirements (install on server if not using Docker)

- **Backend (Python):** `pip install -r backend/requirements.txt`
- **Frontend (Node):** `cd frontend && npm ci` (or `npm install`) — installs all deps including `@types/node` for the build
- **Auth:** JWT access + refresh, TOTP 2FA, RBAC (users/roles/permissions)
- **Schema:** users, roles, permissions, user_roles, role_permissions, user_ssh_keys

## API overview

- **Auth:** `POST /api/auth/login`, `POST /api/auth/refresh`, `GET /api/auth/me`, `POST /api/auth/totp/setup`, `POST /api/auth/totp/verify`, `POST /api/auth/totp/disable`
- **Users (RBAC: users:read / users:write):** `GET /api/users`, `GET /api/users/me`, `GET /api/users/{id}`, `POST /api/users`, `PATCH /api/users/{id}`, `DELETE /api/users/{id}`
- **Roles (RBAC: roles:read / roles:write):** `GET /api/roles`, `GET /api/roles/permissions`, `GET /api/roles/{id}`, `POST /api/roles`, `PATCH /api/roles/{id}`, `DELETE /api/roles/{id}`

Access control: Bearer token in `Authorization` header. Superuser or role with the required permission is allowed.

## Schema (PostgreSQL)

- **users:** id, email, username, hashed_password, is_active, is_superuser, totp_secret, totp_enabled, created_at, updated_at
- **roles:** id, name, description
- **permissions:** id, name, resource, action, description
- **user_roles:** user_id, role_id
- **role_permissions:** role_id, permission_id
- **user_ssh_keys:** id, user_id, name, public_key, fingerprint, created_at (for SSH key–only access later)

Seeded: permissions `users:read`, `users:write`, `roles:read`, `roles:write`, `servers:read`, `servers:write` and an **admin** role with all of them.
