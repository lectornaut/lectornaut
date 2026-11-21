interface LegalDocument {
  // ISO date; shown as "Last updated …" in the sheet header.
  updated: string
  // Markdown body, rendered by AppMarkdown. Start at `##`: the sheet
  // title is the document's h1.
  content: string
}

export type LegalDocumentKey = "terms" | "privacy"

export const legal: Record<LegalDocumentKey, LegalDocument> = {
  terms: {
    updated: "2026-11-19",
    content: `
Welcome to Lectornaut. These terms cover your use of our apps, website and services. By creating an account or using Lectornaut, you agree to them. If you're using Lectornaut on behalf of a company or team, you're agreeing for that organization too.

## Your account

You need an account to use most of Lectornaut. Keep your sign-in details safe and let us know at hello@lectornaut.com if you think someone else has accessed your account. You're responsible for what happens under your account.

You must be at least 16 years old to use Lectornaut.

## Teams and workspaces

Teams own their workspaces and everything in them. Team owners and admins can invite or remove members, change roles, and manage billing. If you join a team, its admins can see the content you create in shared workspaces.

## Your content

What you write, upload or create in Lectornaut is yours. You give us permission to store, process and display it only so we can run the service for you: syncing it across your devices, sharing it with the people you choose, and sending it to AI models when you ask an agent to work on it.

We don't sell your content, we don't show ads, and we don't use your content to train AI models.

## AI agents

Agents can read, write and act on your behalf using the tools and connections you give them. AI output can be wrong, incomplete or out of date, so review anything important before you rely on it. You're responsible for how you use agent output and for the actions you approve.

## Connected services

When you connect Google Calendar, Google Drive, Gmail or GitHub, you authorize Lectornaut to access those accounts within the permissions you grant. You can disconnect them at any time from Settings. Your use of those services is also governed by their own terms.

## Acceptable use

Please don't use Lectornaut to:

- Break the law or infringe anyone else's rights
- Send spam, malware or anything designed to harm people or systems
- Probe, scan or disrupt our infrastructure, or get around usage limits
- Generate content that exploits or endangers others
- Resell or redistribute the service without our written permission

We may suspend accounts that put other users or the service at risk.

## Plans and billing

Paid plans are billed in advance, monthly or yearly, through Stripe. Plans renew automatically until you cancel. You can cancel anytime from Settings, and you'll keep access until the end of the current billing period. Except where the law requires otherwise, payments aren't refundable.

Each plan includes a usage allowance for AI features. Admins can set spending caps, and we'll let you know before you reach a limit. If prices change, we'll tell you at least 30 days ahead.

## Ending your account

You can delete your account at any time from Settings. We may suspend or close accounts that break these terms; when we can, we'll tell you first and give you a chance to export your data.

## Disclaimers

We work hard to keep Lectornaut reliable, but the service is provided "as is", without warranties of any kind. To the extent the law allows, Lectornaut isn't liable for indirect or consequential losses, and our total liability for any claim is limited to the amount you paid us in the 12 months before it.

## Changes to these terms

We'll update these terms as Lectornaut grows. If a change matters, we'll tell you by email or in the app before it takes effect. Continuing to use Lectornaut after that means you accept the new terms.

## Contact

Questions about these terms? Write to us at hello@lectornaut.com.
`.trim(),
  },
  privacy: {
    updated: "2026-11-19",
    content: `
Privacy is one of our core commitments. We don't sell your data, we don't show ads, and we don't have investors pushing us to do either. This policy explains what we collect, why, and the choices you have.

## What we collect

**Account details.** Your name, email address and profile photo, plus how you sign in (email, Google, Microsoft, Apple or your company's SSO).

**Your content.** Documents, chats, agents, workflows, files and anything else you create or upload. This is stored so the service can work, and only shared with the people and agents you choose.

**Connected accounts.** If you connect Google Calendar, Google Drive, Gmail or GitHub, we store the access tokens needed to reach those accounts, and read only the data an action you request requires.

**Billing.** Stripe handles payments. We see your plan, billing history and the last four digits of your card, never the full number.

**Usage and device data.** Basic technical information such as your IP address, browser or app version, operating system and error reports, plus AI usage totals so we can apply plan limits.

## How we use it

- To provide, sync and secure the service
- To run AI features you ask for, by sending the relevant content to a model provider
- To send account emails: sign-in links, security alerts, billing receipts and the notifications you've turned on
- To understand performance and fix bugs
- To meet legal obligations

We don't use your content to train AI models, and we don't build advertising profiles.

## AI providers

When you use an agent, the content needed for that request is sent to the model you've selected from Anthropic, OpenAI, Google or xAI. These providers process it to return a response. Under their API terms, they don't use it to train their models.

## Google user data

Lectornaut's use of information received from Google APIs adheres to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements. We use Google data only to provide the features you've asked for, we don't transfer it to others except as needed to provide those features or comply with the law, and no person reads it unless you ask us to for support, it's needed for security, or the law requires it.

## Who we share it with

We share data only with the service providers that help us run Lectornaut:

- **Google Cloud and Firebase** for hosting, storage, authentication and databases
- **Stripe** for payments
- **Postmark** for email delivery
- **Anthropic, OpenAI, Google and xAI** for AI features

Each one may only use your data to provide its service to us. We'll disclose data to authorities only when the law requires it, and we'll push back on requests that are overly broad.

## Teams

If you're part of a team, its owners and admins can manage your membership and see content in shared workspaces. Depending on the plan, team admins can also review an audit log of account and workspace activity.

## How long we keep it

We keep your data while your account is active. When you delete content, it's removed from our active systems right away and from backups within 30 days. Audit logs are kept for the period your team's plan allows. If you delete your account, we delete your personal data within 30 days, except what we must keep for legal, tax or security reasons.

## Your rights

You can view and update your profile in Settings, disconnect connected accounts, and delete your account at any time. Depending on where you live, you may also have the right to access, correct, export or restrict the use of your data, or object to how we process it. Email hello@lectornaut.com and we'll respond within 30 days.

## Security

Data is encrypted in transit and at rest. We support multi-factor authentication and SSO, limit internal access to what's strictly needed, and keep an audit trail of sensitive actions. No system is perfectly secure, but we'll tell you promptly if a breach affects your data.

## Cookies and local storage

We use only what's needed to keep you signed in and remember your preferences. No advertising or cross-site tracking cookies.

## Children

Lectornaut isn't intended for anyone under 16, and we don't knowingly collect their data.

## Changes to this policy

If we make meaningful changes, we'll let you know by email or in the app before they take effect.

## Contact

Questions or requests about your privacy? Write to us at hello@lectornaut.com.
`.trim(),
  },
}
