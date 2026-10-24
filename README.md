# Lectornaut

> The AI Knowledge Operating System
>
> A personal and team AI research lab that reads, understands, connects, and evolves knowledge.

Lectornaut combines:

1. AI Knowledge Co-Pilot
2. AI Reading and Learning Companion
3. Team Research and Collaboration Tool

### AI chat tool permissions

Open the bot configuration menu in the chat composer and select **Permissions**:

- **Ask** (default): show the existing confirmation card before connected
  Calendar, Drive, Gmail, or GitHub write tools run.
- **Automatic**: a separate AI evaluation approves or denies each of those
  calls against the user's request, using the chat's effective, team-approved
  model. Evaluation uses additional tokens. A denial prevents execution; an
  evaluation error stops the call and reports a failure.
- **Allow**: grant permission without evaluation or confirmation. Connected tools
  may change files or events, post to GitHub, or send email immediately.

The selection is saved per signed-in user on this device and applies across
chat surfaces, including resumed and transferred turns. It does not change
read-only tools, workspace tools, questions, or headless workflows, and never
bypasses membership, tool availability, input validation, or connection grants.
An explicit confirmation-card approval or cancellation always takes precedence
over the selected mode.

### macOS window controls

Native traffic lights keep their system size and stay vertically aligned with
the active header when changing Appearance font size, webview zoom, or both.
`useMacOSWindowControls` observes header geometry and synchronizes it through
the native `align_macos_window_controls` command. The command converts CSS
coordinates to logical window points independently of Retina scaling and
returns a zoom-adjusted CSS width for the shared window-control spacing token.
Tab, page, Zen, and detached chat headers use the same alignment path; fullscreen
suspends alignment and exiting fullscreen resynchronizes it.
The native command also applies the titlebar frame immediately: the current tao
runtime stores traffic-light insets in its setter but only applies them in
`drawRect`, which may not run when WebKit occludes the native content view.

### Settings list and table conventions

Agents, Tools, and Workflows each separate **Built-in**, **Connection**, and
**Custom** resources. Connection rows identify their provider, support
enable/disable, and link to Connections for installation and removal. Agents
and tools supplied by connections are not independently editable or removable.
Workflow deployments can be configured in their workspace, like built-in presets.

Connection resource definitions live in [`shared/connectionResources.ts`](shared/connectionResources.ts).
Each provider declares any combination of `tools`, `agents` (including their
persona `spec`), and `workflows` (including their deployment defaults). Keys
must be globally unique, must not shadow built-ins, and must be safe Firestore
document IDs. Connection agent keys must not start with `_` (reserved for
built-in agent identities). Tools still require server-side handler registration;
declaring a tool does not implement its handler.

Installing a connection registers agents/tools in the existing integrations
collection and workflow templates in team availability. Workflows remain opt-in
per workspace; installation does not start autonomous runs.
The app details dialog lists only resource types the manifest provides.
Increment the provider's positive integer `revision` in the shared manifest when
releasing changes to resources or requested permissions. Installation records
`installedRevision` atomically with resource reconciliation. The app's Settings
tab shows **Update available** when the available revision is newer;
otherwise it shows **Up to date**.
Legacy installations without a recorded revision are offered a one-time update.
**Install updates** is available on the app card, Manage menu, and
**App details → Settings**, sharing the same update action and busy state.
Uninstall lives in **App details → Settings**; disconnect and provider-side
management live on your own connected account in **App details → Accounts**.
These destructive actions retain their confirmation dialogs, and members
cannot disconnect another member's account.
Deploy the client and functions with matching manifest revisions.
Installing updates reconciles owned resources, preserves enable preferences and
workspace workflow edits, and retires removed resources. Existing independently
installed presets (including the Drive digest) are not adopted or overwritten.
Updates keep account bindings intact and do not grant new OAuth permissions;
members must reconnect separately when additional permissions are needed.
Uninstall archives owned integrations and workflow deployments, removes their
availability, and revokes account bindings. Disabling a connection pauses all
three resource types without discarding their configuration.
Installation is team-wide; connected-account availability is per member (or
the workflow's explicitly configured **Run with my connected accounts** identity).
Disconnecting keeps installed resources discoverable but blocks connection
agents/workflows and returns actionable connection-tool failures until reconnect.
Execution checks live installation, binding health and token availability,
including a final check for a connection workflow's or agent's owning account.
Failed connection-tool outputs cannot be converted into successful turns or
workflow runs by the model; explicit user cancellation remains non-error.
Token refresh and OAuth completion cannot recreate credentials after uninstall,
and stale refreshes cannot overwrite a newly reconnected account.
Uninstalled workflow deployments are excluded from client registries; archived
definitions/deployments and run history remain stored for audit and idempotent
restoration, not available for invocation. Independent resources are untouched.
These checks cannot roll back external requests or automatic workspace edits
that already completed before a disconnect; affected runs are reported as errors.
Connection agents also appear as a distinct source in chat/workflow pickers
and the team agent directory. Their profiles are team-local; global public
profile lookup remains limited to built-in and custom agents because a
connection's agent keys repeat across teams.

### Connection PoC catalog

Revision **2** of each existing app adds three agents and manual workflow
templates through the shared manifest, not UI-only entries:

| App             | Agents                                                                    | Workflows                                                                |
| --------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Google Calendar | Meeting Prep Agent; Schedule Optimizer; Daily Agenda Assistant            | Daily agenda report; Weekly schedule review; Meeting briefing with Drive |
| Gmail           | Email Triage Agent; Inbox Summarizer; Email Follow-up Assistant           | Unread inbox digest; Email follow-up report                              |
| Google Drive    | Document Research Agent; File Organization Assistant; Document Summarizer | Document research report; Recent documents digest                        |
| GitHub          | Pull Request Reviewer; Issue Triage Agent; Repository Insights Agent      | Open pull request briefing; Repository activity report                   |

For existing installations, choose **Install updates**. New installations register
all resources directly. Agent and workflow names/descriptions appear in app
details and their **Connection Agents** / **Connection Workflows** sections.
These additions do not change existing tool definitions, permissions, or account
bindings. The independent built-in Google Drive digest remains unchanged.

To try a workflow:

1. Connect the owning app for your member and enable its connection tool.
2. Deploy the template to a workspace using **Default agent** (or a custom agent
   with workspace content management enabled). The PoC agents are read-only
   researchers with workspace writes disabled; use them for interactive analysis,
   not for creating workflow reports.
3. Enable **Run with my connected accounts**. Set any required scope in the
   workflow's additional instructions or attached context: GitHub workflows need
   an explicit `owner/repo`; Document research report needs a research topic.
   Other templates have bounded time/query defaults described in their settings.
4. Run manually and review the proposed new report in the workspace's write tree.
   All templates default to **require review**; installation never schedules them.
   Reports may contain private mail or documents: choose a workspace whose
   membership is appropriate for that data.

Meeting briefing with Drive belongs to Calendar but also requires Drive installed,
enabled, and connected for the **same run identity**, with its search/read tools
available. This dependency is stated in the template, not auto-installed. There is
no declarative cross-app dependency graph; the existing per-tool account checks
enforce access when called. Keep both apps available and inspect run output for
missing-tool/configuration messages. Required inputs and tool-availability
instructions are agent prompts, not an additional configuration-validation form.

These are numbered research procedures executed in a single existing agent turn,
not a new step engine. They use only connected-app reads; headless runs do not
receive external write tools. Interactive agents are instructed to remain
read-only, but this is **not a new tool sandbox**: connection tool groups remain
team-enabled rather than per-agent allowlists, and interactive writes still use
the existing explicit confirmation mechanism. No example requires additional
write permissions or sends mail, changes calendar events, reorganizes Drive, or
posts GitHub reviews.

Coverage is intentionally bounded (typically 10 search results and at most 5
detail reads; Calendar allows up to 25 events). Reports must disclose limits and
cite sources, not claim exhaustive inventories. Calendar gaps are not guaranteed
free/busy availability; event descriptions and attendee identities are not in the
tool response (only titles, timing, locations, attendee counts, and attachment
metadata). Preparation tasks are suggestions, not extracted agendas.
Drive reads cannot extract binary/PDF content, Sheets
cover the first sheet only, and modified times do not reveal revision diffs.
Gmail message searches do not fetch complete threads or prove a message is
unanswered. GitHub supports issue/PR descriptions, comments, and file reads, not
PR diffs, CI/check execution, merge verification, commits, or release analytics;
the reviewer is a **readiness/discussion assistant**, not a patch reviewer.
Model output quality and live provider access still depend on the configured
model, enabled tools, permissions, and account availability.

Entity tables and workflow, agent, and tool cards share `SettingsIdentity` for
titles, optional descriptions, and inline badges. Titles truncate independently
of badges; full titles and descriptions remain available through native title
tooltips. Table avatars use the default 32px size, card portraits use 40px, and
`AppAvatar` keeps the same outer box for photos, generated portraits, and loading.

Sortable columns use `DataTableSortButton`, including those inside
`DataTableColumnHeader`. Keep action cells as table cells with right-aligned inner
controls, reserve a compact actions column, and render dates/counts as muted
metadata with tabular numbers. Descriptions belong below the entity title rather
than being duplicated in a second column.

Selection columns are pinned to the start and actions to the end of the table's
own scroll viewport. Static tables opt in with `data-pinned="start"` or
`data-pinned="end"` on both header and body cells; `DataTable` uses its
`columnPinning` model (select/actions by default). Shared pinning styles provide
opaque surfaces, stacking, edge dividers, and row-state feedback. Table overflow
menus use `DataTableRowActionsButton`: a 40px outlined horizontal-ellipsis button
with an accessible label and consistent disabled/loading states.
Keep the dropdown root inside the trigger tooltip's root so its anchor and
content share the same positioning context; menu content must be outside the
tooltip trigger.

Lifecycle badges use `outline`; classification badges such as Agent, Predefined,
and tool kind use `secondary`. Archived takes precedence over Disabled through
`settingsLifecycleStatus`. Card lists, searchable data tables, and the plan
comparison matrix intentionally retain their distinct layouts and interactions.

## What This Becomes

Lectornaut is not:

- Just a reader
- Just a note app
- Just a chatbot

Lectornaut becomes:

> The operating system for thinking.

## Feature Universe

This document defines the complete platform scope from MVP to enterprise-grade.

### I. Core Platform Architecture

#### 1. Identity and Access

- Email/password login
- OAuth (Google, GitHub, Microsoft)
- Magic link login
- SSO (SAML / OIDC)
- Multi-tenant team architecture
- Workspace-level isolation
- RBAC roles (Owner, Admin, Editor, Commenter, Viewer)
- Invite links with role presets
- Domain-based auto-join
- API keys (personal + workspace)
- Audit logs (every action)
- Session management
- Device management

### II. Document Ingestion Engine

#### 2. Supported Inputs

Files:

- PDF
- EPUB
- DOCX
- TXT
- Markdown
- HTML
- CSV
- PPTX
- XLSX
- Code files (all common languages)
- ZIP (auto-unpack + index)

External sources:

- Public URLs
- Academic papers (arXiv import)
- YouTube (transcript ingestion)
- Podcasts (RSS ingestion + transcription)
- Notion
- Google Drive
- Dropbox
- OneDrive
- Slack threads
- GitHub repositories
- Confluence
- Email (forward to ingest)
- Browser extension (save page)

Manual:

- Paste text
- Live notes
- Voice recording -> auto transcription
- Screenshot -> OCR -> index

#### 3. Ingestion Intelligence

- Auto chunking
- Semantic indexing
- Vector embeddings
- Knowledge graph extraction
- Entity recognition
- Citation extraction
- Footnote parsing
- Table extraction
- Image OCR
- Code parsing
- Math formula parsing
- Auto-tagging
- Auto-topic classification
- Deduplication
- Version tracking
- Change diff detection
- Source credibility scoring
- Content freshness scoring

### III. AI Reading Companion Features

#### 4. Interactive Reading Mode

- Side-by-side AI assistant
- Inline explanation (highlight -> explain)
- Simplify complex text
- Translate text
- Expand summary
- TL;DR mode
- Deep dive mode
- Ask anything about this paragraph
- Contextual Q&A per document
- "Explain like I'm 5"
- Technical deep explanation
- Define terms
- Cross-reference other documents
- Timeline extraction
- Concept breakdown
- Diagram generation from text
- Visual concept mapping
- Highlight-based AI memory

#### 5. Learning and Retention System

- Auto flashcard generation
- Spaced repetition system
- Quiz mode (MCQ, short answer)
- Active recall prompts
- Concept linking exercises
- Knowledge gap detection
- Progress tracking
- Reading streaks
- Personalized study path
- Skill mapping
- AI tutor mode
- Curriculum builder
- Mastery scoring
- Review reminders
- Summary comparison (before/after understanding)

#### 6. Book Intelligence

- Full book summarization
- Chapter breakdown
- Insight extraction
- Key ideas clustering
- Action step generation
- Author philosophy mapping
- Compare books
- Merge insights from multiple books
- Theme extraction
- Quote extraction
- Highlight export
- Personal reflection journaling

### IV. Knowledge Co-Pilot (Personal AI Research Assistant)

#### 7. Cross-Document Intelligence

- Ask across entire library
- Source-cited answers
- Multi-source synthesis
- Conflict detection between sources
- Bias detection
- Evidence strength rating
- Trend detection
- Pattern recognition
- Auto research briefs
- Hypothesis generation
- Argument builder
- Counterargument builder
- Literature review generation
- Executive summary mode
- Deep research mode (multi-hop reasoning)

#### 8. Knowledge Graph System

- Auto concept extraction
- Entity relationships
- Visual graph explorer
- Timeline view
- People map
- Topic clustering
- Custom ontology builder
- Manual edge editing
- Smart recommendations
- Related document surfacing

#### 9. Persistent AI Memory

- Personal memory
- Workspace memory
- Context-aware responses
- Conversation continuity
- Knowledge evolution tracking
- User preference learning
- Writing style adaptation
- Research history tracking
- Long-term context storage
- Smart recall ("What did I read about X in March?")

### V. Team Research Platform

#### 10. Real-Time Collaboration

- Multi-user editing
- Live cursors
- Comment threads
- Inline suggestions
- Mentions (@user)
- Notification system
- Presence indicators
- Version history
- Restore previous version
- Change diff viewer
- Collaborative whiteboard
- Shared highlights
- Shared annotations

#### 11. AI in Teams

- Team AI agent
- Workspace-specific context
- Shared memory
- AI moderator for discussions
- Meeting summary generator
- Decision log extraction
- Research synthesis across team uploads
- Knowledge consolidation
- Duplicate research detection
- Consensus detection
- AI role personas (Legal AI, Research AI, Analyst AI)

#### 12. Research Workspaces

- Research rooms
- Project-based folders
- Document collections
- Tags and smart folders
- Saved AI threads
- Research templates
- Workflow automation
- Kanban for research tasks
- Assign research tasks
- Status tracking

### VI. Advanced AI Capabilities

#### 13. Agent System

- Multi-agent orchestration
- Autonomous research mode
- Web browsing agent
- Citation validation agent
- Data extraction agent
- Summary agent
- Debate agent
- Report generator agent
- Custom agent builder
- Agent memory isolation

#### 14. Autonomous Research Mode

- Goal input
- Research plan generation
- Source discovery
- Multi-source reading
- Iterative refinement
- Structured output
- Report delivery
- Confidence scoring
- Source list
- Evidence map

#### 15. Writing and Output Engine

- Research paper generator
- Blog post generator
- Proposal generator
- Whitepaper generator
- Presentation generator
- Slide deck creator
- Executive brief generator
- Tweet threads from research
- Newsletter drafts
- Code documentation generator
- Policy drafts
- Grant application drafts

### VII. Analytics and Insight Layer

#### 16. Personal Analytics

- Reading time tracking
- Knowledge growth graph
- Topic distribution
- Learning velocity
- Retention score
- Skill progress
- AI usage analytics

#### 17. Team Analytics

- Research velocity
- Contribution heatmaps
- Topic clusters
- Knowledge coverage gaps
- Decision tracking
- Activity logs
- Collaboration score

### VIII. Integrations

- Slack
- Discord
- GitHub
- Linear
- Notion
- Google Docs
- Drive
- Dropbox
- Figma
- Email
- Calendar
- Zapier
- Webhooks
- API SDK
- CLI tool

### IX. Enterprise Features

- Data residency control
- SOC2 readiness
- Encryption at rest
- End-to-end encryption option
- Private LLM hosting option
- On-prem deployment
- Role-based AI controls
- Admin dashboard
- Audit exports
- Compliance logs
- Usage billing controls
- Workspace quotas
- Custom AI model selection

### X. UX Power Features

- Command palette
- Slash commands
- Keyboard-first navigation
- Dark mode
- Custom themes
- Layout modes (reader / researcher / graph)
- Offline mode
- Progressive sync
- Low-latency optimistic UI
- Mobile app
- Tablet reader mode
- Browser extension
- Desktop app (Tauri)

### XI. Monetization Features

- Free tier (limited storage + AI tokens)
- Pro individual
- Team plan
- Enterprise plan
- Usage-based AI billing
- Add-on agents
- API access tier
- White-label option

### XII. Future / Moonshot Features

- AI-generated interactive textbooks
- VR knowledge map
- AI debate arena
- Autonomous research bots
- Predictive insight engine
- Knowledge market (sell curated research)
- Reputation system for contributors
- Verified expert layers
- AI-generated courses
- AI co-founder mode
- Memory across lifetime account
- Personal AI historian
