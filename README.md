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
