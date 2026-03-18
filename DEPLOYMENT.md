# Production Deployment Requirements

## Docker (recommended)

No manual module installation needed. The Docker build installs everything:

- **Backend:** `backend/requirements.txt` is installed during image build
- **Frontend:** `npm install` runs during image build (reads `frontend/package.json`)

### Production deploy (no dev volume mounts)

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml build --no-cache
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

### Development (live-reload)

```bash
docker compose build --no-cache
docker compose up -d
```

## After deploying the panel

1. **Sync each managed server**: In the panel, open the server and click **Sync now**. Or on each server run:
   ```bash
   sudo /etc/sshcontrol/sync-users.sh
   ```
2. **Redeploy servers** (if the deploy script changed): Use **Deploy** from the panel to re-run the install script on each server. This updates `2fa-gate`, `verify-2fa-helper`, sshd config, etc.

## Without Docker (manual install)

### Backend (Python 3.10+)

```bash
cd backend
pip install -r requirements.txt
```

Dependencies: fastapi, uvicorn, sqlalchemy, asyncpg, psycopg2-binary, alembic, pydantic, python-jose, passlib, bcrypt, pyotp, paramiko, cryptography, Pillow.

### Frontend (Node.js 18+)

```bash
cd frontend
npm ci
npm run build
```

`npm ci` installs all dependencies from `package.json` and `package-lock.json`, including:

- **Runtime:** react, react-dom, react-router-dom, qrcode.react
- **Build:** typescript, vite, @vitejs/plugin-react, **@types/node**, @types/react, @types/react-dom

Then serve the `dist/` folder with nginx or any static file server.
