interface ChangelogEntry {
  id: string
  title: string
  content: string[]
  date: string
}

export const changelog: ChangelogEntry[] = [
  {
    id: "2.9.0",
    title: "Lectornaut for Agents",
    content: ["Fixed minor bugs.", "Improved overall stability."],
    date: "2023-10-15T00:00:00Z",
  },
  {
    id: "2.8.0",
    title: "Custom Integrations",
    content: [
      "Browse and install third-party integrations.",
      "API documentation updated.",
    ],
    date: "2023-10-01T00:00:00Z",
  },
  {
    id: "2.7.0",
    title: "Custom Themes",
    content: [
      "Choose from multiple color themes.",
      "Theme editor for advanced users.",
    ],
    date: "2023-09-15T00:00:00Z",
  },
  {
    id: "2.6.0",
    title: "Activity Logs",
    content: ["Track user actions.", "View detailed logs in settings."],
    date: "2023-09-01T00:00:00Z",
  },
  {
    id: "2.5.0",
    title: "Team Collaboration",
    content: ["Invite team members.", "Assign roles and permissions."],
    date: "2023-08-15T00:00:00Z",
  },
  {
    id: "2.4.0",
    title: "Two-Factor Authentication",
    content: ["Added 2FA via email and SMS.", "Enhanced account security."],
    date: "2023-08-01T00:00:00Z",
  },
  {
    id: "2.3.0",
    title: "Accessibility Improvements",
    content: ["Improved keyboard navigation.", "Added ARIA labels."],
    date: "2023-07-15T00:00:00Z",
  },
  {
    id: "2.2.0",
    title: "Export Data",
    content: ["Export user data as CSV or JSON.", "Download reports feature."],
    date: "2023-07-01T00:00:00Z",
  },
  {
    id: "2.1.0",
    title: "Search Functionality",
    content: ["Implemented global search bar.", "Search across all modules."],
    date: "2023-06-15T00:00:00Z",
  },
  {
    id: "2.0.0",
    title: "Major Update",
    content: ["Redesigned application structure.", "Improved scalability."],
    date: "2023-06-01T00:00:00Z",
  },
  {
    id: "1.9.0",
    title: "Profile Customization",
    content: ["Users can update avatars.", "Added bio and social links."],
    date: "2023-05-15T00:00:00Z",
  },
  {
    id: "1.8.0",
    title: "Localization",
    content: [
      "Added support for French and Spanish.",
      "Language selector in settings.",
    ],
    date: "2023-05-01T00:00:00Z",
  },
  {
    id: "1.7.0",
    title: "Dark Mode Support",
    content: ["Introduced dark mode toggle.", "Automatic theme detection."],
    date: "2023-04-15T00:00:00Z",
  },
  {
    id: "1.6.0",
    title: "API Integration",
    content: [
      "Integrated with external API for data sync.",
      "Added error handling for API failures.",
    ],
    date: "2023-04-01T00:00:00Z",
  },
  {
    id: "1.5.0",
    title: "Notifications Feature",
    content: ["Added in-app notifications.", "Custom notification settings."],
    date: "2023-03-15T00:00:00Z",
  },
  {
    id: "1.4.0",
    title: "Bug Fixes",
    content: ["Fixed login redirect issue.", "Resolved UI glitches on Safari."],
    date: "2023-03-01T00:00:00Z",
  },
  {
    id: "1.3.0",
    title: "Performance Enhancements",
    content: ["Optimized loading times.", "Reduced bundle size."],
    date: "2023-02-15T00:00:00Z",
  },
  {
    id: "1.2.0",
    title: "UI Improvements",
    content: ["Updated dashboard layout.", "Improved mobile responsiveness."],
    date: "2023-02-01T00:00:00Z",
  },
  {
    id: "1.1.0",
    title: "Added User Authentication",
    content: [
      "Implemented login and registration.",
      "Added password reset functionality.",
    ],
    date: "2023-01-15T00:00:00Z",
  },
  {
    id: "1.0.0",
    title: "Initial Release",
    content: ["First release of Lectornaut.", "Core features implemented."],
    date: "2023-01-01T00:00:00Z",
  },
]
