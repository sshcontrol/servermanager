# QA Report – Server Manager Project

**Date:** February 22, 2026  
**Scope:** Full project (frontend, backend, Docker)

---

## 1. Build & Compilation

| Check | Status |
|-------|--------|
| Frontend TypeScript build | ✅ Pass |
| Frontend Vite production build | ✅ Pass |
| Linter (frontend) | ✅ No errors |

---

## 2. Project Structure

- **Frontend:** React 18 + TypeScript + Vite
- **Backend:** Python 3.12 + FastAPI
- **Database:** PostgreSQL 15
- **Deployment:** Docker Compose (db, backend, frontend, nginx-proxy-manager)

---

## 3. Routes & Navigation

| Route | Protection | Notes |
|-------|------------|-------|
| `/` | Home/Dashboard | Redirects based on auth/onboarding |
| `/login`, `/signup` | Public | |
| `/server`, `/server/add`, `/server/:id` | Protected | Server groups under Server menu ✓ |
| `/server-groups`, `/server-groups/:id` | Admin only | Under Server menu ✓ |
| `/user-groups`, `/user-groups/:id` | Admin only | Under User menu ✓ |
| `/users`, `/users/add` | Admin only | |
| `/profile`, `/profile/account`, etc. | Protected | |
| `/superadmin/*` | Superadmin only | |
| `/monitor`, `/history` | Admin only | Top bar |

---

## 4. Issues Found & Fixed

### 4.1 Profile sidebar active state (fixed)

- **Issue:** On `/profile/account`, the sidebar "Profile" link did not show as active because it pointed to `/profile` and `subClass` used exact path match.
- **Fix:** Sidebar Profile link updated from `/profile` to `/profile/account` so it highlights correctly on the Account tab.

### 4.2 Version mismatch (fixed)

- **Issue:** `version.ts` showed "5" while `package.json` had "3.7.0".
- **Fix:** `package.json` version set to "5.0.0" to match `version.ts`.

---

## 5. Recommendations

### 5.1 Testing

- No unit or integration tests found.
- **Recommendation:** Add tests for:
  - Auth flows (login, refresh, logout)
  - Protected route behavior
  - API client error handling

### 5.2 Profile navigation

- Profile sidebar shows: Profile (Account), Key, Plan, History Export.
- ProfileLayout tabs: Account, Password, Security, SSH Key, Plan, History Export.
- Password and Security are only reachable via Profile tabs, not the sidebar.
- **Recommendation:** Consider adding Password and Security to the sidebar for consistency, or document this as intentional.

### 5.3 API configuration

- `VITE_API_URL` defaults to `""` (relative URLs).
- Works with Vite proxy (dev) and nginx proxy (production).
- **Recommendation:** Document required env vars for different deployment setups.

### 5.4 Docker

- Backend uses volume mount `./backend:/app`, so code changes apply without rebuild.
- Frontend is built into the image; UI changes require rebuild and `docker compose up -d`.

---

## 6. Summary

| Category | Result |
|----------|--------|
| Build | ✅ All builds pass |
| Navigation | ✅ Server/User groups correctly nested |
| Version | ✅ Aligned to 5 |
| Profile UX | ✅ Active state fixed |
| Tests | ⚠️ None present |
| Linting | ✅ Clean |

---

*Report generated from automated QA review.*
