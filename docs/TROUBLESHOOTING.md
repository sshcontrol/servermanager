# Troubleshooting: "Cannot reach the server" on Login

This error means the frontend cannot connect to the backend API. Follow these steps:

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

## 6. Database

Backend requires PostgreSQL. If `DATABASE_URL` is wrong or the database is down, the backend may fail to start. Check:
```bash
# In backend directory, with .env set:
python -c "from app.database import engine; from sqlalchemy import text; engine.connect().execute(text('SELECT 1'))"
```
