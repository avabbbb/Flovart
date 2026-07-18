# Flovart Privacy Policy

Status: Pre-release draft. This Policy becomes effective when linked from an official public release.

Policy version: 1.0-draft

Publisher: Flovart, published and maintained by the Hong Kong individual open-source developer [@avabbbb](https://github.com/avabbbb) ("Flovart", "we", "us").

Primary legal jurisdiction: Hong Kong Special Administrative Region.

[中文版本](./PRIVACY_POLICY.zh-CN.md)

This Privacy Policy explains how Flovart handles data when you use the Official WebUI at `https://avabbbb.github.io/Flovart/`, desktop builds, browser extension bridge, source code, and related project features.

Flovart is designed as a local-first creative workspace. By default, the official Desktop Edition does not require an account and the publisher does not operate a hosted backend for your canvas, workflows, prompts, generated files, or API keys.

This Policy does not cover third-party AI providers, custom endpoints, browser vendors, operating systems, cloud backup providers, extension stores, payment processors, or websites you connect to through a bridge. Those services have their own policies.


## 1. What Flovart stores locally

Depending on the features you use, Flovart may store data locally on your device, browser, or app profile.

Local data may include:

- Provider settings and API keys. In the current Desktop Edition and Official WebUI implementation, Provider Secrets are encrypted by the application and persisted in an origin-scoped Browser Secret Vault backed by `localforage` / IndexedDB inside the relevant WebView or browser profile. This is application-layer encrypted browser storage, not the operating-system credential store. The official Edge Extension does not store Provider Secrets.
- Workflow projects, nodes, layout, and media.
- Prompts and generation configuration.
- Generated images, videos, references, previews, and metadata.
- Model preferences and custom endpoints.
- Theme, language, layout, and workspace settings.
- Asset library entries, history, pinned outputs, and trace information.
- Browser extension bridge settings if you enable them.

Storage locations may include IndexedDB, small non-business preferences in browser localStorage, extension storage, desktop app storage, local files, operating-system caches, browser profiles, and backup systems you configure.

The Official WebUI and Desktop WebView each create an origin/profile-scoped workspace. They cannot silently read one another's IndexedDB, another website's storage, Windows Credential Manager, or Edge Extension storage. A restricted Local Data Service for explicit project sharing and secret-safe provider invocation is planned but is not available in the current release; current workspaces must be exported/imported separately when moving between entries.


## 2. What Flovart does not operate by default

By default, Flovart does not operate a central account system for your local project data.

By default, Flovart does not run a project-owned cloud database for your prompts, Workflow files, generated media, or API keys.

If you deploy or use a self-hosted or SaaS backend (community hub or enterprise API), that backend may store user account credentials (hashed passwords, JWT tokens), organization data, department structures, role assignments, and community content. The operator of that deployment is the responsible data controller or personal-information processor and must provide its own privacy notice. This Policy does not make the open-source publisher responsible for an independent deployment.

By default, Flovart does not sell personal information.

By default, Flovart does not include product analytics, advertising tracking, or behavioral profiling operated by the project maintainers.

These statements apply to the open-source project as provided. Modified builds, hosted forks, plugins, browser extensions, custom endpoints, or third-party distributions may behave differently.


## 3. Third-party AI providers and custom endpoints

When you use AI features, Flovart sends requests from your device or app environment to the provider or endpoint you configure.

Those requests may include:

- Your API key or authentication token.
- Text prompts and instructions.
- Uploaded images, videos, files, masks, references, or attachments.
- Workflow context, node inputs, generated outputs, and metadata.
- Model names, endpoint URLs, request settings, and run information.

Third-party providers may collect, process, retain, moderate, train on, or disclose data according to their own terms and privacy policies.

You are responsible for reviewing the provider's policy before sending data to it.

Use custom endpoints only if you trust the endpoint operator and understand where your data goes.


## 4. Browser extension and bridge data

The official Edge Extension is a thin companion to Desktop Edition and the Official WebUI. It does not store Provider Secrets, disclose raw Provider Secrets to the Official WebUI, or directly call AI Providers.

Only after a user-triggered import action, an extension build may access selected text, a user-selected image or image URL, basic image metadata, or a visible-tab screenshot, depending on the permissions and capabilities shown by that installed build. The current page URL and title may accompany the imported item as source information.

The official extension is not designed to scan all images on a page or collect browsing history, keystrokes, passwords, cookies, authentication tokens, background page activity, or content from tabs that the user has not acted on. It does not sell data, serve advertising, or send extension analytics to the publisher by default.

A revocable Trusted Web Bridge for sharing approved project data and typed Runtime actions with the Official WebUI is planned but is not available in the current release. Any future bridge must restrict allowed origins, keep pairing and data access visible and revocable, and must not expose an operation that returns a raw Provider Secret.

Desktop Edition may subsequently send imported content to a Provider or custom endpoint only as part of an action initiated or approved by the user. That Provider's policy then applies.

Do not use browser import features on sensitive websites or confidential materials unless you have permission and understand the risk. Browser vendors, extension stores, installed extensions, and websites may apply their own privacy and security rules.


## 5. Data security

Flovart aims to keep user-controlled data local where possible, but no local system is completely secure.

Risks include device compromise, malware, browser profile access, browser sync, cloud backup, shared computers, untrusted extensions, untrusted plugins, local file exposure, and misconfigured custom endpoints.

You are responsible for securing your device, browser, operating system, backups, exported files, and API keys.

If you believe an API key has leaked, revoke it with the provider immediately and create a new key.


## 6. Data deletion and retention

Because Flovart stores data locally by default, deletion usually depends on your device and browser settings.

You can delete local web app data by clearing site data for the Flovart origin in your browser.

The current release does not automatically merge the Official WebUI workspace with Desktop Edition. Clear each origin/profile separately, or use explicit export/import where available.

You can delete non-secret browser extension preferences by removing the extension or clearing extension storage. Provider Secrets are not stored by the official Edge Extension.

The Official WebUI is statically hosted by GitHub Pages. GitHub may process request and security data under its own privacy statement; GitHub documents that visitor IP addresses are logged and stored for security purposes. Flovart does not use GitHub Pages as a backend for your Browser Workspace, prompts, media, or Provider Secrets.

You can delete desktop app data by removing the app data directory used by your operating system.

You can delete exported files, downloaded media, and backups from wherever you saved or synced them.

Flovart maintainers generally cannot recover local data you delete and generally cannot delete copies held by third-party AI providers, custom endpoints, browser sync, cloud backups, or services outside the project.


## 7. Your choices and rights

You control which providers, endpoints, files, prompts, references, and bridge features you use.

- You can choose not to add API keys.
- You can choose not to upload files or references to a provider.
- You can choose not to enable browser extension or bridge permissions.
- You can clear local storage and remove exported files.

Depending on your jurisdiction, you may have rights to access, correct, delete, restrict, export, or object to processing of personal data. Official local builds normally keep project data on your own device, so these controls are exercised locally. Exercise rights concerning data held by a third-party Provider, custom endpoint, browser vendor, extension store, backup provider, or independent deployment with that party.

Mainland China users retain any mandatory rights under the Personal Information Protection Law and other applicable laws. Hong Kong users retain any mandatory rights under the Personal Data (Privacy) Ordinance, including applicable access and correction rights. This Policy does not waive rights that cannot legally be waived.


## 8. Children and minors

Flovart is not intended for children under 13 or the minimum age required in your jurisdiction.

If you are under the age of majority in your jurisdiction, use Flovart only with permission and supervision from a parent or legal guardian.

Do not upload children's personal information, images, school records, health information, or other sensitive material to third-party AI providers unless you have a lawful basis and proper authorization.


## 9. International data transfers

Flovart's local-first design does not itself choose a cloud storage country for your local project data.

However, third-party AI providers, custom endpoints, browser vendors, cloud backups, and extension services may process data in other countries.

Review each provider's privacy policy to understand international transfer and storage practices.


## 10. Changes to this Policy

We may update this Policy from time to time to reflect product changes, security concerns, legal requirements, or changed data flows.

Material changes affecting data categories, destinations, browser permissions, Provider Secret handling, or user choices will receive a new Policy version and renewed notice before the next Provider request or extension data transfer.


## 11. Contact

Project repository: [github.com/avabbbb/Flovart](https://github.com/avabbbb/Flovart)

Public support, privacy questions, and notices: [GitHub Issues](https://github.com/avabbbb/Flovart/issues)

Do not post API keys, passwords, identity documents, private media, confidential information, or other sensitive personal information in a public GitHub Issue. Flovart does not currently provide a separate private privacy email and normally cannot access, recover, correct, or delete data that remains solely on your device or is held by a third party.
