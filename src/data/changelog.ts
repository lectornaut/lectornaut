interface ChangelogEntry {
  id: string
  title: string
  // Markdown body — rendered by markstream-vue's `MarkdownRender`. Keep
  // these strings authored as you'd write a release-notes blob (headings,
  // lists, fenced code, links). Don't pre-parse here; the renderer handles
  // it on the static `:content` path.
  content: string
  date: string
}

/**
 * Application Changelog
 * static list of version history and release notes
 */
export const changelog: ChangelogEntry[] = [
  {
    id: "2.9.0",
    title: "Lectornaut for Agents",
    date: "2023-10-15T00:00:00Z",
    content: `### Added

- **Agent SDK** integration — call \`useBotChat()\` from any composable.
- Streaming responses with cancellation when the user switches sessions.

### Fixed

- Resolved a race in the Firestore session reconciler that could overwrite an in-flight reply.
- Improved overall stability across long-running chats.`,
  },
  {
    id: "2.8.0",
    title: "Custom Integrations",
    date: "2023-10-01T00:00:00Z",
    content: `- Browse and install third-party integrations from the new **Integrations** tab.
- API documentation refreshed with end-to-end examples.
- Added webhook signing for outbound events.`,
  },
  {
    id: "2.7.0",
    title: "Custom Themes",
    date: "2023-09-15T00:00:00Z",
    content: `Choose from multiple color themes, or build your own with CSS custom properties:

\`\`\`css
:root {
  --color-primary: oklch(0.65 0.2 250);
  --color-accent: oklch(0.75 0.15 30);
}
\`\`\`

The theme editor exposes every token live for instant preview.`,
  },
  {
    id: "2.6.0",
    title: "Activity Logs",
    date: "2023-09-01T00:00:00Z",
    content: `- Track every user action across your workspace.
- Filter logs by actor, target, and time range.
- Export selected ranges to CSV from the activity panel.`,
  },
  {
    id: "2.5.0",
    title: "Team Collaboration",
    date: "2023-08-15T00:00:00Z",
    content: `### Added

- Invite team members from the **Members** settings page.
- Role-based permissions: \`owner\`, \`admin\`, \`editor\`, \`viewer\`.
- Per-workspace visibility on shared resources.

### Changed

- Mention notifications now respect per-channel mute settings.`,
  },
  {
    id: "2.4.0",
    title: "Two-Factor Authentication",
    date: "2023-08-01T00:00:00Z",
    content: `- Added 2FA via **email** and **SMS**.
- TOTP support is rolling out next.
- Backup codes are generated on enrollment — save them somewhere safe.`,
  },
  {
    id: "2.3.0",
    title: "Accessibility Improvements",
    date: "2023-07-15T00:00:00Z",
    content: `- Improved keyboard navigation across modals and dropdowns.
- Added ARIA labels for every icon-only button.
- Focus rings now respect the user's \`prefers-reduced-motion\` setting.`,
  },
  {
    id: "2.2.0",
    title: "Export Data",
    date: "2023-07-01T00:00:00Z",
    content: `Export user data as CSV or JSON from the command palette:

\`\`\`bash
lectornaut export --format=json --output=data.json
\`\`\`

Reports can also be downloaded directly from the dashboard.`,
  },
  {
    id: "2.1.0",
    title: "Search Functionality",
    date: "2023-06-15T00:00:00Z",
    content: `> Press \`⌘K\` (or \`Ctrl+K\`) to open the global search anywhere in the app.

- Search across documents, members, and settings.
- Recent results pin to the top.
- Fuzzy matching tolerates typos.`,
  },
  {
    id: "2.0.0",
    title: "Major Update",
    date: "2023-06-01T00:00:00Z",
    content: `A foundational rewrite focused on **scalability** and **developer ergonomics**.

### Highlights

- New plugin architecture: load capabilities on demand.
- Modular state with type-safe stores.
- 40% faster initial render on cold load.

### Breaking changes

- The legacy \`/v1/api/*\` endpoints are now read-only and retire in 3.0.
- Custom themes from 1.x must be re-saved against the new token names.

See the [upgrade guide](#) for migration steps.`,
  },
  {
    id: "1.9.0",
    title: "Profile Customization",
    date: "2023-05-15T00:00:00Z",
    content: `- Users can update avatars from the profile settings page.
- Bio and social links now display on hover cards.
- Profile pages support markdown formatting.`,
  },
  {
    id: "1.8.0",
    title: "Localization",
    date: "2023-05-01T00:00:00Z",
    content: `Added language support for \`fr\`, \`es\`, \`ja\`, and \`de\`. The selector lives under **Settings → Language**.

Translations are crowd-sourced — contribute on our [translation portal](#).`,
  },
  {
    id: "1.7.0",
    title: "Dark Mode Support",
    date: "2023-04-15T00:00:00Z",
    content: `- Introduced the dark mode toggle in the top-right menu.
- Automatic theme detection via \`prefers-color-scheme\`.
- All charts and visualizations now respect the active theme.`,
  },
  {
    id: "1.6.0",
    title: "API Integration",
    date: "2023-04-01T00:00:00Z",
    content: `Sync data with external services using our typed client:

\`\`\`ts
import { client } from "@lectornaut/api"

const projects = await client.projects.list({ limit: 50 })
\`\`\`

Failed requests now surface structured errors with retry hints.`,
  },
  {
    id: "1.5.0",
    title: "Notifications Feature",
    date: "2023-03-15T00:00:00Z",
    content: `- Added in-app notifications with unread badges.
- Customize delivery channels per category.
- Snooze notifications until a specified time.`,
  },
  {
    id: "1.4.0",
    title: "Bug Fixes",
    date: "2023-03-01T00:00:00Z",
    content: `- Fixed login redirect issue when arriving from a deep link.
- Resolved UI glitches on Safari 16.
- Restored keyboard shortcuts inside iframe-embedded views.`,
  },
  {
    id: "1.3.0",
    title: "Performance Enhancements",
    date: "2023-02-15T00:00:00Z",
    content: `- **Initial render**: 1.8s → 1.1s on the median p50 device.
- **Bundle size**: trimmed by 22% via dynamic imports.
- **Memory**: long sessions now cap at ~120MB regardless of history depth.`,
  },
  {
    id: "1.2.0",
    title: "UI Improvements",
    date: "2023-02-01T00:00:00Z",
    content: `- Updated dashboard layout with a denser grid.
- Mobile responsiveness across every settings panel.
- Hover states for every interactive element.`,
  },
  {
    id: "1.1.0",
    title: "Added User Authentication",
    date: "2023-01-15T00:00:00Z",
    content: `Added login, registration, and password reset flows.

\`\`\`ts
const router = createRouter({
  routes: [
    { path: "/login", component: LoginView },
    { path: "/register", component: RegisterView },
    { path: "/reset", component: PasswordResetView },
  ],
})
\`\`\``,
  },
  {
    id: "1.0.0",
    title: "Initial Release",
    date: "2023-01-01T00:00:00Z",
    content: `**Welcome to Lectornaut.** Our first public release ships the foundations:

- Workspaces, projects, and tasks
- Real-time collaboration
- A clean, opinionated UI

Thanks for joining us at the beginning of the journey.`,
  },
]
