# Troubleshooting: "Cannot reach the server" on Login / Verification

This error means the frontend cannot connect to the backend API. It often appears **after Google OAuth** when the backend is unreachable (e.g. backend down, wrong proxy config). Follow these steps:

## 1. Verify the backend is running

**Local development:**
```bash
cd backend
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

**Docker:**
```bash
docker compose up -d
docker compose ps   # backend and db should be "Up"
```

## 2. Test the backend directly

```bash
curl http://localhost:8000/health
```

Expected: `{"status":"ok"}`

If this fails:
- Backend is not running, or
- Backend crashed on startup (check logs: `docker compose logs backend` or the terminal where uvicorn runs)
- Common causes: missing `DATABASE_URL`, `SECRET_KEY`, or PostgreSQL not running

## 3. Check your setup

| Setup | Frontend | Backend | Proxy target |
|-------|----------|---------|--------------|
| **Local dev** (both on same PC) | `npm run dev` (port 3000) | `uvicorn` (port 8000) | `http://localhost:8000` (default) |
| **Docker** | Container (port 3000) | Container (port 8000) | `http://backend:8000` (nginx) |
| **Frontend on PC, backend on server** | `npm run dev` | On remote server | Set `PROXY_TARGET=http://YOUR_SERVER_IP:8000` in frontend `.env` |

## 4. If using `VITE_API_URL`

When set, the frontend makes direct requests to that URL instead of using the proxy. Ensure:
- The URL is correct (e.g. `http://localhost:8000` or your server IP)
- Backend allows CORS from your frontend origin
- Backend is reachable from the browser (same machine or exposed port)

## 5. Firewall

If backend is on a remote server, ensure port 8000 is open:
```bash
sudo ufw allow 8000
sudo ufw reload
```

## 6. Docker: frontend can't reach backend

If you use Docker and access via https://sshcontrol.com (or your domain):
- Nginx Proxy Manager must forward `/api` to the backend. Ensure your NPM proxy config includes `/api` or forwards all paths to the frontend container (which proxies `/api` to backend).
- The frontend container's nginx proxies `/api` to `http://backend:8000`. Both must be on the same Docker network.
- If frontend is behind NPM and backend is on a different host, set `VITE_API_URL` and rebuild: `VITE_API_URL=https://sshcontrol.com docker compose build --no-cache frontend`

## 7. CORS (when using VITE_API_URL for remote backend)

If the frontend uses `VITE_API_URL` to point to a different origin, the backend must allow that origin. Set `CORS_ORIGINS` in your `.env` (comma-separated), e.g.:
```
CORS_ORIGINS=https://your-frontend.com,http://192.168.1.100:3000
```
The default list includes localhost, 127.0.0.1, sshcontrol.com, and 65.21.240.77. LAN IPs (192.168.x.x, 10.x.x.x) are allowed via regex.

## 8. Gateway Timeout when restoring database backup

Database restore can take several minutes. If you see **504 Gateway Timeout**:

1. **Frontend nginx** (included in this project): `proxy_read_timeout` is set to 600s in `frontend/nginx.conf`. Rebuild the frontend to apply:
   ```bash
   docker compose build --no-cache frontend && docker compose up -d frontend
   ```

2. **Nginx Proxy Manager** (or another reverse proxy in front): Increase the proxy read timeout to at least 600 seconds (10 minutes). In NPM: edit your proxy host → Custom locations or Advanced → add:
   ```
   proxy_read_timeout 600s;
   proxy_send_timeout 600s;
   ```

## 9. Database

Backend requires PostgreSQL. If `DATABASE_URL` is wrong or the database is down, the backend may fail to start. Check:
```bash
# In backend directory, with .env set:
python -c "from app.database import engine; from sqlalchemy import text; engine.connect().execute(text('SELECT 1'))"
```
