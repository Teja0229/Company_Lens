

## 📌 Project Overview

The **Company Data Scraping & Management Dashboard** is a modern full-stack web application designed for intelligent company intelligence gathering, real-time web scraping, and structured database management.

Instead of waiting for an entire batch scraping process to finish, the platform follows an optimized **Database-First & Sequential Live Streaming** workflow:
1. When a user searches for a company, the system **immediately queries the database** and displays existing matching records on the dashboard without delay.
2. If new results or fresh data are requested, the automated scraper begins processing candidate targets **sequentially**.
3. As each individual company website is scraped, its extracted data is **instantly pushed and rendered onto the dashboard in real time**, accompanied by live status badges and activity highlights.
4. The system continues scraping the next website in the queue and updates the dashboard row-by-row until complete.

The backend is powered by Node.js, Express, and Supabase (Authentication & PostgreSQL), while web scraping is driven by Python, Selenium WebDriver, and BeautifulSoup.

---

## 🚀 Key Features

### 🔍 1. Company Search & Sequential Live Scraping
- **Direct Search by Company Name**: Search by company name directly, with optional location filters (City, Country).
- **Database-First Match Display**: Existing records in Supabase matching the search query appear instantly on the dashboard with a highlighted database match badge.
- **Sequential Website Scraping**: Scrapes websites one at a time. The moment a site is scraped, its company name, contact numbers, email, address, and live website link stream onto the dashboard immediately before moving to the next website.
- **Real-Time Visual Indicators**: Active scraping banner and animated table updates notify users when new records arrive.

### 📊 2. Interactive Analytics Dashboard
- **Live Metrics**: Total companies collected, companies with verified websites, verified phone numbers, and location distribution.
- **Dynamic Search & Filtering**: Instant client-side search across company names, locations, and contact info, plus quick filters for website and phone presence.
- **Export Capabilities**: One-click export of filtered or full company datasets to **CSV**.
- **Real-time Deduplication Notice**: Duplicate detection alerts and automatic data normalization for consistent formatting.

### 👤 3. Detailed Company Profiles
- Dedicated profile view (`company-profile.html`) accessible via "Open Profile" for every company.
- Displays comprehensive data:
  - Official Website with direct link
  - Primary Contact Number
  - Support & Inquiries Email
  - Physical Address & Location
  - Social & Professional Links (LinkedIn, etc.)
  - Associated Employees and Team Members list

### 🔐 4. Secure Authentication & User Management
- **Supabase Authentication**: Secure session token handling, email/password authentication.
- **User Registration & Login**: Streamlined registration with validation and error alerts.
- **Password Recovery**: Complete Forgot Password (`forgotpswd.html`) and Password Reset (`reset.html`) workflow.
- **Account Management & Deletion**: Dedicated account deletion endpoint (`DELETE /api/users/delete-account`) to completely remove user profiles and session data on request.

### 🎨 5. Responsive UI & Dual Theme System
- Fully responsive across desktop, tablet, and mobile viewports (`responsive.css`).
- Built-in Dark and Light mode switcher (`theme.js` & `theme.css`) with persistent user preferences saved to `localStorage`.
- High-contrast typography and accessible color palettes.

---

## 🔄 Core Application Workflow

```text
User Enters Search Query (Company Name [+ Location])
                     │
                     ▼
  ┌───────────────────────────────────────┐
  │ 1. Instant Database Search            │
  │    GET /api/companies/search?query=.. │
  └──────────────────┬────────────────────┘
                     │
                     ├────────► Display Matching Database Records Immediately
                     │
                     ▼
  ┌───────────────────────────────────────┐
  │ 2. Sequential Scraping Pipeline       │
  │    POST /api/scrapes                  │
  └──────────────────┬────────────────────┘
                     │
         ┌───────────┴───────────┐
         │ Loop Candidate Targets │
         └───────────┬───────────┘
                     │
                     ▼
        Scrape Target 1 Website (HTML / JS)
                     │
                     ▼
        Instantly Push & Display Target 1 on Dashboard
                     │
                     ▼
        Scrape Target 2 Website (HTML / JS)
                     │
                     ▼
        Instantly Push & Display Target 2 on Dashboard
                     │
                     ▼
           (Repeat Until Completed)
                     │
                     ▼
        Upsert Clean Records to Supabase DB
```

---

## 🏗️ System Architecture

```text
                        ┌─────────────────────────┐
                        │      Client Browser     │
                        │ HTML5 / CSS3 / ES6 JS   │
                        └────────────┬────────────┘
                                     │
                 ┌───────────────────┴───────────────────┐
                 │ HTTP (REST)                           │ Supabase Auth Client
                 ▼                                       ▼
    ┌─────────────────────────┐             ┌─────────────────────────┐
    │     Express Backend     │             │        Supabase         │
    │      (Node.js API)      │             │  Authentication & DB    │
    │  - normalizers.js       │             │  - Users & Sessions     │
    │  - server.js            │◄───────────►│  - Companies Table      │
    │  - cleanup_duplicates   │             │  - Feedback Table       │
    └────────────┬────────────┘             └─────────────────────────┘
                 │
                 │ Child Process / Service Call
                 ▼
    ┌─────────────────────────┐
    │     Python Scrapers     │
    │ - google_maps_scraper   │
    │ - scraper_service       │
    │ - Selenium WebDriver    │
    │ - BeautifulSoup4        │
    └─────────────────────────┘
```

---


## 🛠️ Technologies Used

### Frontend
- **HTML5 & CSS3**: Semantic markup and modern CSS Grid/Flexbox layouts.
- **Modular CSS**: Separated into `theme.css`, `responsive.css`, `dashboard.css`, `auth.css`, and `home.css`.
- **Vanilla JavaScript (ES6+)**: Fast, lightweight client-side state handling without heavy bundle overhead.

### Backend
- **Node.js & Express.js**: REST API server handling company data, live scraping orchestration, and user deletion.
- **Normalizers Module (`normalizers.js`)**: Single source of truth for normalizing:
  - Place IDs
  - Company Names (stripping suffixes, normalizing casing)
  - Websites (standardizing protocols, stripping trailing slashes)
  - Phone Numbers (E.164 and international formatting)
  - Addresses

### Web Scraping Engine
- **Python 3**: Automation and parsing runtime.
- **Selenium WebDriver**: Headless Chrome browser automation for JavaScript-rendered sites.
- **BeautifulSoup4**: Fast, efficient HTML parsing and extraction.

### Database & Authentication
- **Supabase (PostgreSQL)**: Scalable relational storage for companies, employees, feedback, and user profiles.
- **Supabase Auth**: Secure JWT-based authentication and user session control.

---

## 📡 REST API Endpoints
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Healthcheck endpoint to verify API and Supabase connectivity |
| `GET` | `/api/companies` | Retrieve all stored companies with optional search, sorting, and limit parameters |
| `GET` | `/api/companies/search?query=...` | Fast direct search for matching company names in the database |
| `GET` | `/api/companies/:id` | Retrieve detailed company data, contacts, and employee lists |
| `POST` | `/api/scrapes` | Trigger the sequential scraping pipeline (`companyName`, optional `city`/`country`) |
| `POST` | `/api/feedback` | Store user feedback into the database |
| `DELETE` | `/api/users/delete-account` | Securely delete a user account and associated credentials |

---

## ⚙️ Installation & Setup

### Prerequisites
- **Node.js**: v18.0.0 or higher
- **Python**: v3.9 or higher
- **Google Chrome** & compatible **ChromeDriver** installed (for Selenium)
- A **Supabase** account with an active project

---

### Step 1: Clone the Repository
```bash
git clone https://github.com/your-username/web-dashboard.git
cd web-dashboard
```

---

### Step 2: Backend Setup & Environment Variables
1. Navigate into the `Backend` directory:
   ```bash
   cd Backend
   ```
2. Install Node.js dependencies:
   ```bash
   npm install
   ```
3. Install Python dependencies:
   ```bash
   pip install -r requirements.txt
   ```
4. Create and configure your `.env` file (refer to `.env.example`):
   ```env
   PORT=5000
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_KEY=your-supabase-anon-or-service-key
   ```
5. Test Supabase connection:
   ```bash
   node supabase.js
   ```
6. Start the API server:
   ```bash
   npm start
   # or
   node server.js
   ```
   *The server will run on `http://localhost:5000`.*

---

### Step 3: Frontend Setup
The frontend uses standard web standards and requires no build step.

You can launch it using any static web server:
- **VS Code Live Server**: Right-click `frontend/index.html` and choose **"Open with Live Server"**.
- **Python HTTP Server**:
  ```bash
  cd frontend
  python -m http.server 3000
  ```
- Open `http://localhost:3000` in your web browser.

---

## 🧹 Database Maintenance & Deduplication

To identify and merge duplicate companies stored in the Supabase database:

```bash
cd Backend
node cleanup_duplicates.js
```

This utility uses `normalizers.js` to cross-reference records by Place ID, official website URL, and normalized company name, merging employee relations and purging redundant entries.

---

## 🎯 Verification & Quality Assurance

All JavaScript and Python modules pass static verification:
```powershell
# Node.js syntax checks
node --check Backend/server.js
node --check Backend/normalizers.js
node --check Backend/cleanup_duplicates.js
node --check Backend/supabase.js
node --check frontend/api.js
node --check frontend/theme.js

# Python compilation checks
python -m py_compile Backend/google_maps_scraper.py Backend/scraper_service.py
```

---

## 👨‍💻 Author

**Thulasi Teja Kuruva**  
B.Tech – Computer Science and Engineering (Cyber Security)

---

## 📄 License

This project is developed for educational and portfolio purposes.
#   C o m p a n y _ L e n s  
 