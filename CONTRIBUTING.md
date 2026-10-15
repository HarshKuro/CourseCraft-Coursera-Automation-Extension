# Contributing to CourseCraft

Thank you for your interest in contributing to **CourseCraft**! CourseCraft is a 100% free, local-first browser extension designed to help students and self-learners streamline routine learning tasks, manage course materials, and boost productivity on Coursera.

Repository: [https://github.com/HarshKuro/CourseCraft-Coursera-Automation-Extension](https://github.com/HarshKuro/CourseCraft-Coursera-Automation-Extension)

---

## 🛠️ Development Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/HarshKuro/CourseCraft-Coursera-Automation-Extension.git
   cd CourseCraft-Coursera-Automation-Extension
   ```

2. **Load Unpacked in Chrome / Edge / Brave / Opera:**
   - Navigate to `chrome://extensions/` (or `edge://extensions/`).
   - Enable **Developer mode** (toggle in top-right corner).
   - Click **Load unpacked** and select the root directory of this repository.

3. **Verify Installation:**
   - Pin the **CourseCraft** icon in your browser toolbar.
   - Open any Coursera course page (e.g., `https://www.coursera.org/learn/<course-slug>/`).
   - Open the popup to see active session status, User ID, and automation actions.

---

## 📋 Contribution Guidelines

1. **Local-First & Zero Telemetry:**
   CourseCraft operates 100% client-side in the user's browser. Never introduce remote analytics, tracking scripts, or closed paywalls. All AI features must connect directly to user-supplied endpoints (e.g., Google Gemini AI API) without intermediary proxy servers.

2. **Branching & Commits:**
   - Create a feature branch: `git checkout -b feature/my-new-feature`
   - Use conventional commit messages: `feat(scope): ...`, `fix(scope): ...`, `docs: ...`

3. **Code Quality:**
   - Validate JavaScript syntax using `node --check <file>` before committing.
   - Maintain clean, modern async/await patterns and format with standard 2-space indentation.

4. **Pull Requests:**
   - Submit PRs against the `main` branch at [https://github.com/HarshKuro/CourseCraft-Coursera-Automation-Extension/pulls](https://github.com/HarshKuro/CourseCraft-Coursera-Automation-Extension/pulls).
   - Provide a clear summary of changes and testing steps on Coursera course pages.
