SMARTSTOCK - no PHP version
===========================
Files (all go in the same folder on your hosting):
  index.html, style.css, auth.css, app.js, accounts.js
Extra tool (optional, keep on your own computer): account-generator.html

HOW TO PUT IT ONLINE (free options)
  - GitHub Pages: create a repository, upload the files, Settings > Pages > deploy from main branch.
  - InfinityFree / any web host: upload the files into the htdocs (or public_html) folder with FileZilla.
  Your site must open with https:// (GitHub Pages and InfinityFree both offer this) because sign-in uses the
  browser's built-in security functions, which only work on https or localhost.

FIRST SIGN-IN
  Username: admin      Password: Admin@2026!    (temporary)
  1. Open the Admin Panel.  2. Click "Reset password" on the admin row and set a strong password.
  3. Click "Publish changes", download accounts.js, upload it to your website replacing the old one.
  4. Refresh. The temporary password no longer works.

ADDING YOUR CUSTOMERS (up to 20)
  Admin Panel > + Add user > Publish changes > upload the new accounts.js. Then send the user their link,
  username and password. Do the same to disable, delete or reset a password.

FORGOT THE ADMIN PASSWORD
  Open account-generator.html on your computer, create an Administrator entry, paste it into accounts.js, upload.

IMPORTANT LIMITS (please read)
  - There is no server. Each user's products and sales are saved in THEIR OWN browser, on that device only.
    Clearing the browser data, or using another phone or computer, shows empty data. Use Settings > Download backup.
  - You cannot see your users' business data.
  - Sign-in protects the app screens, but all the code is public. A technical person can copy the code or bypass the
    sign-in on their own copy. The 20-user limit and the passwords stop ordinary users, not determined ones.
  - If your repository is public, accounts.js (which holds scrambled passwords) is public too. Use strong passwords.
