<div align="center">
  <img src="./assets/banner.png" alt="JeetoPlay Banner" width="100%">
  
  <h1>🎮 JeetoPlay </h1>
  <p><strong>A Highly Scalable, Real-Money Gaming & Esports Platform</strong></p>

  <p>
    <img src="https://img.shields.io/badge/Node.js-43853D?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js" />
    <img src="https://img.shields.io/badge/Firebase-ffca28?style=for-the-badge&logo=firebase&logoColor=black" alt="Firebase" />
    <img src="https://img.shields.io/badge/Supabase-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white" alt="Supabase" />
    <img src="https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  </p>
</div>

## 📖 Overview
JeetoPlay is a production-ready real-money gaming application that hosts live Esports tournaments (BGMI, Free Fire) and casual games like Ludo. Built for high concurrency and atomic financial transactions, it provides a seamless and secure environment for users to deposit funds, join matches, and withdraw winnings.

> **💡 The Architecture Evolution: Surviving a $50k Cloud Bill**
> 
> Within days of launching, JeetoPlay went viral, scaling rapidly to **4,000 active users**. Our initial architecture relied heavily on Firebase Realtime Database (RTDB) and Firebase Cloud Functions for complex state management (wallets, matchmaking, live leaderboards). 
> 
> **The Bottleneck:** The massive influx of users triggered an explosion of active RTDB listeners and inefficient Cloud Function cold-starts, resulting in an astronomical **$50,000 Firebase bill in just 3 days**.
> 
> **The Engineering Fix:** We re-architected the platform under pressure. We migrated our most intensive read/write operations—specifically Authentication (OTP flows) and Wallet/Transaction Ledgers—from Firebase to **Supabase Edge Functions and PostgreSQL**. This hybrid architecture leverages Firebase for real-time low-latency match states and Supabase for highly scalable, cost-efficient transactional data, successfully reducing our infrastructure costs by 99% while improving platform stability.

## 🚀 Key Features

*   **Atomic Wallet System:** Secure financial ledger with two-tier balances (Deposit & Winnings). Employs strict transactional locking to prevent race conditions and duplicate withdrawal exploits.
*   **Real-time Gaming Hub:** Live match status tracking and automated matchmaking utilizing Firebase Realtime Database.
*   **Advanced Dispute Resolution:** A 3-button resolution system (Lost/Won/Dispute) with timeout-based auto-escalation for Ludo matches.
*   **Scalable Edge Authentication:** Migrated from Firebase Auth to Supabase Edge Functions for secure, rapid, and cost-effective OTP verification.
*   **Dynamic Deposit Bonuses:** Configurable, stacking promotional systems managed via a real-time admin portal.
*   **Live Leaderboards & Stats:** Aggregated real-time metrics for Overall, eSports, Ludo, and Referral rankings.
*   **Comprehensive Admin Dashboard:** Full operational control over users, transactions, refunds, platform fees, and system configurations.

## 🛠️ Tech Stack

*   **Frontend:** Vanilla JavaScript (ES6+), HTML5, CSS3, Vite
*   **Backend:** Node.js, Firebase Cloud Functions
*   **Edge Compute:** Supabase Edge Functions (Deno / TypeScript)
*   **Database:** Firebase Realtime Database, Supabase PostgreSQL
*   **DevOps & Security:** Google Secret Manager, Supabase Vault, Firebase Hosting

## 🔒 Security Posture

*   **No Hardcoded Secrets:** Complete migration from hardcoded credentials to secure environment variables.
*   **Granular DB Rules:** Strict Firebase Realtime Database rules ensuring user-isolated data access and validated state transitions.
*   **Atomic Transactions:** Guaranteed consistency during high-load match fee deductions and reward distributions.

## 💻 Local Development Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/JeetoPlay.git
   cd JeetoPlay
   ```
2. **Install Dependencies**
   ```bash
   npm install
   ```
3. **Configure Environment Variables**
   * Review the deployment guidelines to set up your `.firebaserc` and Supabase config.
   * Add necessary secrets to your `.env` file (ensure `.env` is ignored by Git).
4. **Run Development Server**
   ```bash
   npm run dev
   ```

## 📝 License
This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
