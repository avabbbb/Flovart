# Flovart End User Terms and Disclaimer

Status: Pre-release draft. These Terms become effective when linked from an official public release.

Terms version: 1.0-draft

Publisher: Flovart, published and maintained by the Hong Kong individual open-source developer [@avabbbb](https://github.com/avabbbb) ("Flovart", "we", "us").

Primary legal jurisdiction: Hong Kong Special Administrative Region.

[中文版本](./TERMS_OF_SERVICE.zh-CN.md)

These Terms govern the official Flovart Desktop Edition, the Official WebUI at `https://avabbbb.github.io/Flovart/`, the official Flovart Edge Extension, and any optional service expressly linked to these Terms. The source code is separately licensed under AGPL-3.0-only; these Terms do not reduce or add restrictions to rights granted by that license.

You accept these Terms when you expressly check the acceptance box in Desktop Edition or the Official WebUI before first persisting a Provider Secret or making a Provider request, or when you continue using the Edge Extension after its first-use disclosure. If you do not agree, do not connect a Provider or use the Edge Extension.


## 1. Service description

Flovart is a local-first AI creative workspace. Its current product surfaces are Workflow for node-based generation, Table for focused single-input processing, and Agent for task and coding-agent collaboration, together with AI-assisted creation and project utilities.

Self-hosted deployments may optionally include backend services (community hub and enterprise API) for user authentication, prompt sharing, organization management, department/role-based access control, and desktop auto-update distribution. These backend services are operated and secured by the deployer.

Flovart does not provide AI model service, hosted inference, API credits, payment accounts, or guaranteed access to any third-party provider by default.

You choose the providers, models, API keys, custom endpoints, local files, prompts, references, and workflows you use.

Desktop Edition and the Official WebUI can be used without registering a Flovart account. The Official WebUI and Desktop WebView currently create separate origin/profile-scoped workspaces. The official Edge Extension is an optional thin companion and is not required for Workflow, Table, Agent, or Provider use.

We may update, change, hide, rename, remove, or discontinue features over time.


## 2. Eligibility and responsibility

You must be old enough and legally permitted to use Flovart in your jurisdiction.

If you use Flovart for a business, organization, client, employer, or other entity, you represent that you have authority to do so.

You are responsible for your device, browser profile, API keys, project files, local storage, exports, extensions, workflows, generated content, and any activity that happens through your setup.


## 3. Source license

The Flovart source code is licensed under AGPL-3.0-only.

AGPL-3.0 is a strong copyleft license. If you copy, modify, distribute, host, or provide network access to Flovart or a modified version, you may need to preserve notices, provide corresponding source code, and comply with other AGPL-3.0 obligations.

You are responsible for understanding whether your copying, modification, distribution, hosted service, private fork, commercial build, extension, or integration triggers license obligations.

The official license text is in the repository [LICENSE](../LICENSE) file.

To the extent these Terms conflict with AGPL-3.0-only regarding use, copying, modification, or distribution of the source code, the AGPL license controls. Product rules in these Terms apply to official binaries, the official store extension, optional services, Provider use, and conduct outside the scope of the source license.


## 4. API keys and third-party services

Flovart uses a bring-your-own-key model.

You may configure official or third-party Providers, proxies, aggregators, self-hosted gateways, custom Base URLs, and model identifiers. Flovart does not certify an endpoint merely because the software allows you to enter or call it.

You are responsible for obtaining, securing, rotating, revoking, and paying for your own API keys and provider accounts.

When you call a third-party AI provider or custom endpoint, you may transmit prompts, uploaded files, images, videos, references, generated outputs, request metadata, account identifiers, and other content to that provider.

Third-party providers are governed by their own terms, privacy policies, billing rules, data practices, retention rules, safety policies, and acceptable-use policies.

Flovart is not responsible for third-party identity, security, pricing, charges, outages, moderation, data retention, training practices, policy enforcement, account suspension, endpoint behavior, protocol compatibility, or output quality.

You are responsible for all fees, quota usage, losses, and disputes caused by your provider keys, endpoints, or workflows.


## 5. Local data and security risk

Flovart is designed to keep project data local where possible, but local-first does not mean risk-free.

Depending on your environment, data may be stored in browser localStorage, IndexedDB, extension storage, desktop app storage, local files, operating-system caches, browser profiles, synced browser accounts, cloud backups, or other local mechanisms.

You are responsible for securing your device, browser, operating system, API keys, backups, exports, and local or synced storage.

If you use a shared computer, browser sync, remote desktop, malware-infected device, untrusted extension, untrusted plugin, or untrusted custom endpoint, your data and keys may be exposed.

If an API key may have leaked, revoke it at the provider immediately and create a new key.


## 6. Browser extension and bridge features

An official Edge Extension build may import the page content and metadata covered by the permissions and actions shown in that installed build only after a user-triggered action. A revocable Trusted Web Bridge to the Official WebUI and automatic Desktop activation are planned capabilities and are not available in the current release.

The official Edge Extension does not store Provider Secrets, disclose them to the Official WebUI, or directly call AI Providers. Provider requests remain the responsibility of the selected browser-local or Desktop Runtime environment after the user reviews or initiates the relevant action.

Only grant browser permissions or import page context when you understand what data may be read and transferred. Do not use browser import features on sensitive websites, private documents, financial accounts, medical portals, legal portals, work systems, or confidential pages unless you have permission and understand the risk.


## 7. User content and generated output

You retain responsibility for the prompts, files, images, videos, references, text, project data, workflows, and other materials you provide to Flovart.

As between you and Flovart maintainers, you are responsible for reviewing the ownership, license, legality, reliability, accuracy, and appropriateness of your inputs and outputs.

AI-generated output can be wrong, incomplete, outdated, misleading, biased, unsafe, offensive, infringing, or unsuitable for your intended use.

Flovart does not guarantee that AI output is accurate, original, lawful, non-infringing, commercially usable, or fit for a particular purpose.

You should independently evaluate output before publishing, selling, relying on, or distributing it.

You must not use output relating to identifiable individuals in a way that could create legal, financial, reputational, safety, or material impact on those individuals without lawful basis and qualified human review.


## 8. Acceptable use

You agree to use Flovart only for lawful purposes and in accordance with these Terms.

You agree not to use Flovart to create, edit, automate, distribute, or facilitate unlawful, abusive, exploitative, deceptive, privacy-invasive, infringing, or harmful content.

You agree not to violate third-party rights, including copyright, trademark, privacy, publicity, confidentiality, contractual, or data-protection rights.

You agree not to bypass provider safety systems, rate limits, authentication systems, payment systems, browser protections, website protections, access controls, or legal restrictions.

You agree not to upload secrets, passwords, API keys, private personal data, regulated data, confidential business data, client files, or third-party copyrighted material unless you have authorization and understand the receiving party's terms.


## 9. No high-stakes reliance

Flovart and its AI outputs are not designed for legal, medical, financial, safety-critical, employment, credit, housing, insurance, education, or other high-impact decisions.

Do not rely on Flovart output as a substitute for professional judgment.

Where an output may affect real-world decisions or rights, qualified human review and compliance review are required.


## 10. Privacy

Your use of Flovart is also governed by the [Privacy Policy](./PRIVACY_POLICY.md).

Flovart itself is intended to operate locally, but your actions may still transmit data to third parties when you call providers, use custom endpoints, load remote media, use browser extensions, export files, publish work, sync browser data, use cloud backup, or enable integrations.

You are responsible for deciding what data may be transmitted and whether you have the right to transmit it.


## 11. No warranties

Flovart is provided as is and as available.

To the maximum extent permitted by law, Flovart is provided without warranties of any kind, whether express, implied, statutory, or otherwise.

No warranty is made that Flovart will be secure, uninterrupted, error-free, accurate, compatible, lawful for your use case, or fit for a particular purpose.

No warranty is made that third-party providers, browser APIs, local storage, extensions, custom endpoints, generated output, exported files, or workflows will behave as expected.


## 12. Limitation of liability

To the maximum extent permitted by law, maintainers, contributors, and project operators are not liable for indirect, incidental, special, consequential, exemplary, or punitive damages.

This includes lost profits, lost revenue, lost data, lost API keys, leaked content, provider charges, account suspension, business interruption, reputational harm, infringement claims, compliance failures, or losses caused by AI output, third-party providers, local storage, browser extensions, or custom endpoints.

Some jurisdictions do not allow certain limitations of liability, so some limitations may not apply to you.


## 13. Changes to these Terms

We may update these Terms from time to time to reflect product changes, legal requirements, security concerns, or business needs.

The Terms version shown at the top identifies the version you accepted.

Material changes affecting Provider charges, data flows, permissions, or responsibility boundaries require renewed local acceptance before the next Provider request. Non-material wording or contact changes may be published without interrupting local-only editing.

If you do not agree to updated Terms, you may continue using rights granted by AGPL-3.0-only for the source code, but must not use an official feature or service that requires acceptance of the updated Terms.

## 14. Governing law and mandatory rights

These Terms are governed by the laws of the Hong Kong Special Administrative Region, without regard to conflict-of-law rules. The courts of Hong Kong have non-exclusive jurisdiction over disputes relating to these Terms.

Nothing in these Terms excludes consumer, privacy, personal-information, or other rights that cannot lawfully be excluded in the place where you live or use Flovart. Users in Mainland China retain any mandatory rights that apply under the Personal Information Protection Law and other applicable laws. Users in Hong Kong retain any mandatory rights under the Personal Data (Privacy) Ordinance and other applicable laws.


## 15. Contact

Project repository: [github.com/avabbbb/Flovart](https://github.com/avabbbb/Flovart)

Public support, policy questions, and notices: [GitHub Issues](https://github.com/avabbbb/Flovart/issues)

Do not post API keys, passwords, identity documents, private media, confidential information, or other sensitive personal information in a public GitHub Issue. Flovart does not currently provide a separate private support email. Because official local builds do not normally send project data to the publisher, most local data access and deletion requests must be completed on the user's own device as described in the Privacy Policy.
