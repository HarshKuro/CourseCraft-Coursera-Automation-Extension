# CourseCraft 🚀

[![Version](https://img.shields.io/badge/version-4.6.0-blue.svg?style=for-the-badge)](https://github.com/HarshKuro/CourseCraft-Coursera-Automation-Extension)
[![Manifest](https://img.shields.io/badge/Manifest-V3-purple.svg?style=for-the-badge)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![License](https://img.shields.io/badge/License-MIT-emerald.svg?style=for-the-badge)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Coursera-orange.svg?style=for-the-badge)](https://www.coursera.org)
[![Privacy](https://img.shields.io/badge/Privacy-100%25%20Local--First-cyan.svg?style=for-the-badge)](HOW_IT_WORKS.md)
[![AI](https://img.shields.io/badge/AI-Google%20Gemini-pink.svg?style=for-the-badge)](https://aistudio.google.com/)

> **CourseCraft** is the next-generation, **100% free**, local-first browser extension designed to automate routine coursework, streamline study workflows, archive course materials, and assist learning on Coursera.

**Official Repository:** [https://github.com/HarshKuro/CourseCraft-Coursera-Automation-Extension](https://github.com/HarshKuro/CourseCraft-Coursera-Automation-Extension)

---

## ✨ Features at a Glance

| Feature | Action Name | Description |
| :--- | :--- | :--- |
| ⚡ **Complete Full Course** | `All-in-One Engine` | One-click automation for every lecture, reading, dialogue, widget & forum in the entire course. |
| 🎥 **Fast-Track Lecture** | `Auto-Watch` | Validates and syncs exact millisecond watch times with Coursera database replicas. |
| 🍿 **Binge All Lectures** | `Batch Videos` | Automatically processes and completes every video lecture across all course modules. |
| 📖 **Speed-Read Modules** | `Auto-Read` | Instantly completes all reading materials, articles, and supplementary study guides. |
| 🤖 **AI Dialogue Solver** | `AI Coach` | Automates Coursera GraphQL AI Coach conversations, milestone summaries, and sessions. |
| 🧩 **Auto-Solve Practice** | `Widget Solver` | Fetches genuine widget session IDs and completes interactive practice sandboxes. |
| 💬 **Auto-Engage Forums** | `Discussion Copilot` | Generates and posts high-quality, relevant peer responses to module discussion prompts. |
| 🧠 **Smart Exam Copilot** | `Quiz Assistant` | AI-assisted quiz solver powered by Google Gemini, with auto-filling and Honor Code signing. |
| 📦 **Archive Vault (ZIP)** | `Study Backup` | Packages the complete course outline, syllabus, and study resources into an offline ZIP bundle. |
| 🔗 **Export Clean URL** | `Shareable Link` | Generates clean, tracking-parameter-free Coursera links ready for peer sharing. |
| 📊 **Live Execution Logs** | `Diagnostics Drawer` | Built-in terminal monitoring real-time HTTP requests, response bodies, and Coursera sync status. |
| 👤 **Account & User ID Card**| `Session Sync` | Displays authenticated user email, session status, and provides an instant numeric ID override tool. |

---

## 🚀 Quick Start & Installation

CourseCraft works on all modern Chromium-based browsers (**Google Chrome**, **Microsoft Edge**, **Brave**, **Opera**, **Vivaldi**).

### Step 1: Download or Clone
```bash
git clone https://github.com/HarshKuro/CourseCraft-Coursera-Automation-Extension.git
```
*(Or click **Code** > **Download ZIP** on GitHub and unzip the archive into a folder).*

### Step 2: Load into Browser
1. Open your browser and navigate to the Extensions management page:
   - **Chrome**: `chrome://extensions/`
   - **Edge**: `edge://extensions/`
   - **Brave**: `brave://extensions/`
2. Enable **Developer mode** via the toggle switch in the top-right corner.
3. Click the **Load unpacked** button.
4. Select the `CourseCraft-Coursera-Automation-Extension` folder.

### Step 3: Start Learning
1. Pin the **CourseCraft** icon to your browser toolbar.
2. Navigate to any enrolled course on [Coursera](https://www.coursera.org) (e.g. `https://www.coursera.org/learn/<course-slug>/`).
3. Click the CourseCraft icon to open the popup.
4. Your account email and session ID are automatically recognized. Choose **Complete Full Course** or trigger individual module tasks!

---

## 🧠 Smart Exam Copilot (Gemini AI Quiz Assistance)

CourseCraft includes a client-side AI quiz copilot powered directly by Google Gemini:

1. Obtain a free Gemini API key from [Google AI Studio](https://aistudio.google.com/).
2. Open CourseCraft, click the **Settings (⚙️)** gear icon in the header.
3. Paste your API key and select your preferred model (e.g., `gemini-1.5-flash` or `gemini-2.0-flash`).
4. On any quiz, exam, or assignment page, click **Smart Exam Copilot** (or press `Alt + Z`).
5. CourseCraft extracts question prompts, queries Gemini directly from your browser, highlights correct options, signs your Honor Code agreement, and prepares your submission.

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Description |
| :--- | :--- |
| **`Alt + B`** | Open CourseCraft Popup Drawer |
| **`Alt + W`** | Toggle CourseCraft Interface |
| **`Alt + Z`** | Activate Smart Exam Copilot on Quiz Page |

---

## 🔒 100% Local-First & Privacy Guaranteed

- **Zero Analytics & Zero Telemetry**: CourseCraft contains no tracking pixels, tracking scripts, or analytics beacons.
- **No Proxy Servers**: All API calls go directly between your browser and Coursera (or Google AI for Gemini).
- **100% Free**: No subscriptions, no tiers, no locked features, and no external registration servers.
- **Secure Credentials**: All session cookies and tokens remain securely within your local browser sandbox.

---

## 📚 Technical Documentation

For an in-depth breakdown of Coursera's reverse-engineered API protocols, video progress validation, GraphQL AI Coach handshakes, and database replica synchronization, read:

👉 **[HOW_IT_WORKS.md](HOW_IT_WORKS.md)** — Architectural Deep-Dive & Protocol Reference.

---

## 🤝 Contributing

Contributions, bug reports, and feature requests are welcome! Check out [CONTRIBUTING.md](CONTRIBUTING.md) to get started.

---

## 📄 License

This project is open-source software licensed under the **[MIT License](LICENSE)**.

Developed and maintained by **[HarshKuro](https://github.com/HarshKuro)** and the **CourseCraft Contributors**.
