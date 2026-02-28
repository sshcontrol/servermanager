# SSHCONTROL – Application Overview

*Internal documentation. Not for publication.*

This document describes the SSHCONTROL application, its features, dashboards, and technical stack. Add screenshots of each page in the indicated sections.

---

## 1. Technical Stack

### Frontend
- **Framework:** React 18
- **Build tool:** Vite 5
- **Language:** TypeScript
- **Routing:** React Router DOM 6 (HashRouter)
- **Libraries:**
  - `qrcode.react` – TOTP QR code generation for 2FA setup
  - Custom components (Logo, Toast, Modals, etc.)

### Backend
- **Framework:** FastAPI
- **Server:** Uvicorn
- **Database:** PostgreSQL (async via asyncpg)
- **ORM:** SQLAlchemy 2 (async)
- **Migrations:** Alembic

### Backend Libraries
| Library | Purpose |
|---------|---------|
| `fastapi` | Web API framework |
| `uvicorn` | ASGI server |
| `sqlalchemy` | ORM and database access |
| `asyncpg` | Async PostgreSQL driver |
| `psycopg2-binary` | Sync PostgreSQL (Alembic migrations) |
| `pydantic` | Data validation |
| `python-jose` | JWT tokens |
| `passlib` / `bcrypt` | Password hashing |
| `pyotp` | TOTP 2FA |
| `paramiko` | SSH key handling |
| `cryptography` | Cryptographic operations |
| `Pillow` | Image processing |
| `sendgrid` | Transactional email |
| `stripe` | Payments |
| `reportlab` | PDF generation |
| `httpx` | HTTP client (Google OAuth, etc.) |
| `smpplib` | SMS via SMPP |

---

## 2. Dashboards Overview

SSHCONTROL has **three distinct dashboards** depending on user role:

| Dashboard | Role | Description |
|-----------|------|--------------|
| **Tenant Admin Dashboard** | Admin or User within a tenant | Main app: servers, users, SSH keys, plan & billing |
| **Platform Superadmin Dashboard** | Platform owner (superuser, no tenant) | Platform-wide: tenants, plans, email, backup, settings |
| **User Dashboard** | Regular user (non-admin) | Limited: server access, profile, SSH keys |

---

## 3. Public Pages (No Login Required)

### 3.1 Landing Page
*[Add screenshot: Landing page]*

- Marketing page with features, benefits, how it works, pricing, FAQ, contact
- **Panel** button opens login/signup popup
- Sign In and Sign Up tabs in popup (email/password + Google OAuth)
- reCAPTCHA on login when configured

### 3.2 Login Page (`/#/login`)
*[Add screenshot: Login page]*

- Username, password, optional 2FA code, optional SMS code
- Sign in with Google (when OAuth configured)
- Links: Forgot password, Create account
- reCAPTCHA when enabled

### 3.3 Signup Page (`/#/signup`)
*[Add screenshot: Signup page]*

- Company name, full name, email, password
- Sign up with Google (when OAuth configured)
- Terms and conditions checkbox
- Link to Sign in

### 3.4 Public Plans (`/#/plans`)
*[Add screenshot: Public plans page]*

- List of available plans with pricing
- Sign In link

### 3.5 Forgot Password / Reset Password
- Request reset link via email
- Reset password with token from email

### 3.6 Accept Invitation (`/#/accept-invitation`)
- Accept tenant invitation via token link
- Set password and complete signup

### 3.7 Verify Email
- Email verification after signup (when verification is enabled)

---

## 4. Onboarding (Welcome Flow)

### Welcome / Onboarding (`/#/welcome`)
*[Add screenshot: Welcome steps]*

Multi-step onboarding for new users:
- **Set username** (if required)
- **Set password** (if required)
- **Two-Factor Auth (2FA)** – TOTP setup with QR code
- **Phone number** – Optional, for SMS verification
- **Plan selection** (admins only)
- **Getting started** – Short guide

---

## 5. Tenant Admin Dashboard (Main App)

### 5.1 Dashboard (`/`)
*[Add screenshot: Admin dashboard]*

**Admin view:**
- Welcome message
- **Servers** card: online/offline counts, link to server list
- **Users** card: active/inactive counts, link to users
- **My groups** section: user groups, server groups, assigned servers

**User view:**
- Simplified dashboard with assigned servers and groups

### 5.2 Servers

#### Add Server (`/server/add`)
*[Add screenshot: Add server]*

- Add server by hostname
- Deploy script / registration token
- Server appears after agent registration

#### Server Access (`/server/access`)
*[Add screenshot: Server access]*

- View servers the user can access
- SSH connection info (hostname, username, key)

#### Modify Servers (`/server`)
*[Add screenshot: Server list]*

- List all servers (admin)
- Status, hostname, IP, sync status
- Edit, deploy script, delete

#### Server Detail (`/server/:id`)
*[Add screenshot: Server detail]*

- Server info, users with access, deploy script
- Platform key, sync status

#### Server Groups (`/server-groups`)
*[Add screenshot: Server groups]*

- Create and manage server groups
- Assign users/groups to server groups with roles

### 5.3 Users

#### Add User (`/users/add`)
*[Add screenshot: Add user]*

- **Invite mode:** Send email invitation
- **Manual mode:** Create user with email, username, password, optional phone, roles, server access
- Phone verification flow when phone is provided

#### Modify Users (`/users`)
*[Add screenshot: Modify users]*

- List users with search
- Edit: username, email, status, 2FA, phone, roles, server access
- Delete user (with destructive verification)
- Pending invitations

#### User Groups (`/user-groups`)
*[Add screenshot: User groups]*

- Create and manage user groups
- Assign members to groups
- Used for server group access

### 5.4 Security

#### Whitelist IP (`/security/whitelist-ip`)
*[Add screenshot: Whitelist IP]*

- Restrict SSH access to whitelisted IPs
- Add IPs per user or globally

#### VPN (`/security/vpn`)
*[Add screenshot: VPN]*

- VPN-related security settings

### 5.5 Monitor & History

#### Online Users (`/monitor`)
*[Add screenshot: Online users]*

- Users with active panel sessions (last 5 minutes)
- SSH session status per server

#### History (`/history`)
*[Add screenshot: History]*

- Audit log of actions (logins, changes, etc.)

### 5.6 Profile

#### Account (`/profile/account`)
*[Add screenshot: Profile account]*

- View/edit full name, email, username

#### Password (`/profile/password`)
*[Add screenshot: Profile password]*

- Change password

#### Security (`/profile/security`)
*[Add screenshot: Profile security]*

- 2FA (TOTP): enable/disable
- Phone: add/verify for SMS
- SMS verification toggle

### 5.7 Plan & Billing

#### Plan (`/plan-billing/plan`)
*[Add screenshot: Plan]*

- Current plan, limits (users, servers)
- Upgrade options (Stripe checkout)

#### Billing (`/plan-billing/billing`)
*[Add screenshot: Billing]*

- Billing info, payment method
- Stripe customer portal

#### Payment History (`/plan-billing/payment`)
*[Add screenshot: Payment history]*

- List of past payments

### 5.8 SSH Keys

#### Keys (`/keys`)
*[Add screenshot: Keys]*

- User’s SSH public keys
- Add, remove keys
- Keys are synced to servers where the user has access

### 5.9 History Export

#### History Export (`/history-export`)
*[Add screenshot: History export]*

- Export audit log (CSV/PDF)

---

## 6. Platform Superadmin Dashboard

*Only for platform owner (superuser with no tenant).*

### 6.1 Tenants (`/superadmin/tenants`)
*[Add screenshot: Superadmin tenants]*

- List all tenants (organizations)
- Create, edit, delete tenants
- Owner info, plan, status
- Assign plans to tenants

### 6.2 Users (`/superadmin/users`)
*[Add screenshot: Superadmin users]*

- All users across tenants
- Search, filter
- Edit user details

### 6.3 Plans (`/superadmin/plans`)
*[Add screenshot: Superadmin plans]*

- Define plans (name, limits, price, Stripe price ID)
- Create, edit plans

### 6.4 Email (`/superadmin/email`)
*[Add screenshot: Superadmin email]*

- Email templates (verification, reset password, etc.)
- SendGrid configuration

### 6.5 Backup (`/superadmin/backup`)
*[Add screenshot: Superadmin backup]*

- Database backup
- Download backup files

### 6.6 Payment (`/superadmin/payment`)
*[Add screenshot: Superadmin payment]*

- Payment transactions across tenants
- Revenue reports, filters

### 6.7 Settings (`/superadmin/settings`)
*[Add screenshot: Superadmin settings]*

- **Google Analytics, Ads, Tag Manager**
- **Google OAuth** (Sign in with Google)
- **reCAPTCHA** (login protection)
- **SEO** (meta tags, description)

### 6.8 Notifications (`/superadmin/notifications`)
*[Add screenshot: Superadmin notifications]*

- Send in-app notifications to users/tenants

### 6.9 SMS (`/superadmin/sms`)
*[Add screenshot: Superadmin SMS]*

- SMPP configuration for SMS
- SMS verification settings

### 6.10 History (`/superadmin/history`)
*[Add screenshot: Superadmin history]*

- Platform-wide audit log

---

## 7. Other Pages

### Payment Result (`/payment-result`)
*[Add screenshot: Payment result]*

- Stripe checkout success/cancel redirect
- Shows payment status

### Auth Callback (`/#/auth/callback`)
- OAuth callback (e.g. Google)
- Stores tokens and redirects to app

---

## 8. Key Features Summary

| Feature | Description |
|---------|-------------|
| **Multi-tenant** | Organizations (tenants) with isolated data |
| **SSH key management** | Add keys, sync to servers via agent |
| **Server groups** | Group servers, assign access by user/group |
| **User groups** | Group users for access control |
| **2FA (TOTP)** | Optional two-factor authentication |
| **SMS verification** | Optional phone verification |
| **Google OAuth** | Sign in / sign up with Google |
| **IP whitelisting** | Restrict SSH by IP |
| **Plan & billing** | Stripe subscriptions, plan limits |
| **Audit log** | Action history, export |
| **Email** | Verification, reset password, invitations |
| **SMS** | SMPP-based SMS for verification |

---

## 9. User Roles

| Role | Access |
|------|--------|
| **Platform Superadmin** | Full platform control, superadmin dashboard |
| **Admin** (tenant) | Full tenant control: servers, users, billing, security |
| **User** (tenant) | Server access, profile, SSH keys |

---

*Document version: 1.0. Add screenshots in each section as indicated.*
