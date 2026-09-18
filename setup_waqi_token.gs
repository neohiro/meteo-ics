/**
 * WAQI Token Setup Helper
 * 
 * Run this ONCE in the Apps Script console (Ctrl+Enter) after deploying either script.
 * 
 * Prerequisites:
 * 1. Get free WAQI token from https://aqicn.org/api/
 * 2. Choose a strong passphrase (min 12 chars, mixed case + digits, no 6+ repeated chars)
 * 
 * Usage:
 *   waqiTokenSave("your_waqi_token_here", "YourStrongPassphrase123!");
 * 
 * Then set Script Property: WAQI_PASSPHRASE = "YourStrongPassphrase123!"
 * 
 * The token is AES-encrypted and stored in Google Drive as "waqi_token.enc".
 * Collaborators with editor access CANNOT decrypt without the passphrase.
 */

// ============================================================
// COPY-PASTE THIS INTO APPS SCRIPT CONSOLE AND RUN:
// ============================================================

/*
// REPLACE THESE VALUES:
const MY_WAQI_TOKEN = "your_token_from_aqicn_org";
const MY_PASSPHRASE = "YourStrongPassphrase123!";  // Min 12 chars, mixed case + digits

// RUN:
waqiTokenSave(MY_WAQI_TOKEN, MY_PASSPHRASE);

// THEN: In Apps Script UI → Project Settings (⚙) → Script Properties
// Add: WAQI_PASSPHRASE = "YourStrongPassphrase123!"
*/

// ============================================================
// VERIFICATION — Run after setup to confirm:
// ============================================================

/*
// Should return your token (not empty, not "circuit_open"):
console.log("Token resolved:", waqiTokenResolve() ? "✓ OK" : "✗ FAILED");

// Check Drive for encrypted file:
const files = DriveApp.getRootFolder().getFilesByName("waqi_token.enc");
console.log("Drive file exists:", files.hasNext() ? "✓ OK" : "✗ MISSING");

// Test AQI fetch with WAQI (requires valid token):
// This will be tested automatically on next syncWeatherToCalendar() or ICS feed generation
*/

// ============================================================
// PASSPHRASE REQUIREMENTS (enforced by waqiTokenSave):
// ============================================================
// - Minimum 12 characters
// - At least 2 of: lowercase, uppercase, digits
// - No 6+ repeated characters (e.g., "aaaaaa" invalid)
// 
// GOOD: "MyStr0ngPass!", "Weather2024!", "AmsterdamNL#1"
// BAD:  "password", "PASSPHRASE", "123456789012", "aaaaaaaaaaaa"