# GAS web app adapter

This adapter packages the React card app as a Google Apps Script web app. It can serve the interface and, after private Drive assets are configured, read card data and images for the signed-in owner.

## Build and sync

From the `webapp` directory:

```powershell
npm run build:gas
clasp push --force
```

The build writes `AppBundle.html` and `AppStyles.html`. `.claspignore` excludes the intermediate `generated/` directory, README, and `.clasp.json`; `.clasp.json` contains the private Apps Script project ID and must stay out of Git.

## Private assets

The app expects a private Drive folder containing `cards_db.json`, `rules_db.json`, and `01.webp` through `36.webp`. Set `LENORMAND_ASSET_FOLDER_ID` in Script Properties after the assets are approved and uploaded. The manifest requests Drive read-only scope, which applies broadly to the deploying account's Drive. Review that consent screen before authorizing it.

Do not put card images, card meanings, reading rules, access tokens, or account data in the public source repository. The web app must remain restricted to the deploying account unless a separate access-control design is reviewed.

## ChatGPT plan integration status

ChatGPT plan authentication and inference are intentionally not implemented in this adapter. OpenAI's current Sign in with ChatGPT documentation describes open-source local apps and self-hosted VMs. It describes remotely hosted apps separately as an integration requiring OpenAI review. Google Apps Script is not identified as a supported self-hosted VM, so this project must not transfer refresh tokens to Script Properties or call the Responses API from GAS unless OpenAI confirms this deployment path.

If this adapter is used before an approved integration exists, its scope is card display and local browser history; ChatGPT interpretation must be opened separately by the user. Apps Script quotas and availability can change. A personal Google Apps Script account currently has a six-minute execution limit and daily URL Fetch quotas; those limits are not a service guarantee.

The GAS test deployment currently remains an earlier smoke-test version. Do not treat it as the finished application or share its URL until private assets, access settings, mobile behavior, and the selected ChatGPT workflow have been resolved.
