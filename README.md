# Keco Studio Local Deployment Guide (macOS / Windows)

This document describes how to locally deploy and run the `keco-studio` project on **macOS or Windows**.

---

## 1. Prerequisites

### 1. Install Docker Desktop (Required)

Supabase relies on Docker. Please install Docker Desktop and ensure it is running properly.

* Official Docker download:
  [https://www.docker.com/products/docker-desktop/](https://www.docker.com/products/docker-desktop/)

---

## 2. Download the Source Code

Project repository:
[https://github.com/Caerulean-ai/keco-studio](https://github.com/Caerulean-ai/keco-studio)

### 1. Create a project directory and open a terminal

* **macOS**: Terminal / iTerm
* **Windows**: PowerShell / Windows Terminal

```bash
# Create a directory
mkdir project

# Enter the directory
cd project
```

---

### 2. Clone the repository and switch branches

```bash
# Clone the repository
git clone https://github.com/Caerulean-ai/keco-studio.git

# Enter the project directory
cd keco-studio

# List all branches
git branch -a

# Switch to the main branch
git checkout main

# Pull the latest code
git pull origin main
```

#### Common Issues

* **Git is not installed**

  * Git official website:
    [https://git-scm.com/](https://git-scm.com/)

  * Verify installation:

    ```bash
    git --version
    ```

* **Failed to connect to GitHub via HTTPS**

  * Configure SSH access instead:
    [https://blog.csdn.net/shenyuan12/article/details/108351561](https://blog.csdn.net/shenyuan12/article/details/108351561)

---

## 3. Environment Setup

### 1. Node.js (Required)

It is recommended to install **Node.js LTS (18.x or 20.x)**.

* Official download:
  [https://nodejs.org/](https://nodejs.org/)

Verify installation:

```bash
node --version
npm --version
```

---

### 2. npm (Upgrade to the latest version)

```bash
npm install -g npm@latest

npm --version
```

---

## 4. Running the Project

### 1. Install project dependencies

```bash
npm install
```

---

### 2. Start the local Supabase service

```bash
supabase start
```

On first run, Docker images will be pulled automatically. This may take several minutes.

After startup, the terminal will output:

* Local Supabase URL
* anon public key

---

### 3. Configure environment variables

Create or edit the `.env.local` file in the project root directory:

```env
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=[Copy the anon key (Publishable value) from the supabase start output]
```

---

### 4. Database migrations (Optional)

Database migrations are applied automatically when Supabase starts.

To reset the database and reapply migrations manually:

```bash
supabase db reset
```

---

### 5. Start the frontend development server

```bash
npm run dev
```

Access the application at:

```
http://localhost:3000
```

---

### 6. Stop services

```bash
# Stop the frontend development server
Ctrl + C

# Stop Supabase
supabase stop
```

---

## 5. Frequently Asked Questions (FAQ)

### 1. `supabase start` cannot connect to Docker

* Ensure Docker Desktop is running
* Restart Docker Desktop and try again

---

### 2. Port already in use

* Make sure no other Supabase or PostgreSQL services are running locally

* You can run:

  ```bash
  supabase stop
  ```

---

### 3. Node.js version incompatibility

* Use **Node.js LTS**
* Consider using nvm or fnm to manage multiple Node versions

---

## 6. Notes

* This project uses the **Next.js + Supabase** tech stack
* Local Supabase is intended for development and testing only
* The `.env.local` file should **not** be committed to the repository

---

