import React from "react";

// Minimal inline outline icon set — no external dependency, matches the app's restrained
// Apple-esque style (single stroke, currentColor, rounded caps). Purely decorative additions to
// existing UI; none of these carry behavior.
const base = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

export const IconDocument = (props) => (
  <svg {...base} {...props}>
    <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
    <path d="M14 3v5h5" />
    <path d="M9 13h6M9 17h6M9 9h2" />
  </svg>
);

export const IconWand = (props) => (
  <svg {...base} {...props}>
    <path d="M4 20 15.5 8.5" />
    <path d="M17 3l1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2Z" />
    <path d="M5 13l.7 1.4L7 15l-1.3.6L5 17l-.7-1.4L3 15l1.3-.6L5 13Z" />
  </svg>
);

export const IconUsers = (props) => (
  <svg {...base} {...props}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3.5 20c.7-3.4 3-5.2 5.5-5.2s4.8 1.8 5.5 5.2" />
    <path d="M15.5 6.2a3.2 3.2 0 0 1 0 6.3" />
    <path d="M15 14.9c2.1.3 3.9 2 4.5 5.1" />
  </svg>
);

export const IconHelpCircle = (props) => (
  <svg {...base} {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.3 9.3a2.7 2.7 0 1 1 3.9 2.4c-.8.5-1.2 1-1.2 2" />
    <path d="M12 17h.01" />
  </svg>
);

export const IconUpload = (props) => (
  <svg {...base} {...props}>
    <path d="M12 15V4" />
    <path d="M7.5 8.5 12 4l4.5 4.5" />
    <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
  </svg>
);

export const IconSparkChart = (props) => (
  <svg {...base} {...props}>
    <path d="M3 20h18" />
    <rect x="5" y="12" width="3.2" height="8" rx="0.6" />
    <rect x="10.4" y="7" width="3.2" height="13" rx="0.6" />
    <rect x="15.8" y="15" width="3.2" height="5" rx="0.6" />
  </svg>
);

export const IconPhoneCall = (props) => (
  <svg {...base} {...props}>
    <path d="M4.5 4h3.2l1.4 4-2 1.4a11.5 11.5 0 0 0 5.5 5.5l1.4-2 4 1.4V17a2 2 0 0 1-2.2 2A16 16 0 0 1 3.5 6.2 2 2 0 0 1 4.5 4Z" />
  </svg>
);

export const IconTrendUp = (props) => (
  <svg {...base} {...props}>
    <path d="M3 16.5 9.5 10l4 4L21 6" />
    <path d="M15.5 6H21v5.5" />
  </svg>
);

export const IconRefresh = (props) => (
  <svg {...base} {...props}>
    <path d="M3.5 12a8.5 8.5 0 0 1 14.6-6" />
    <path d="M20.5 12a8.5 8.5 0 0 1-14.6 6" />
    <path d="M18.1 6v-3.2M18.1 6h-3.2" />
    <path d="M5.9 18v3.2M5.9 18H9" />
  </svg>
);

export const IconClock = (props) => (
  <svg {...base} {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3.2 2" />
  </svg>
);

export const IconCheckCircle = (props) => (
  <svg {...base} {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M8 12.5 10.8 15 16 9" />
  </svg>
);

export const IconGrid = (props) => (
  <svg {...base} {...props}>
    <rect x="3.5" y="3.5" width="7" height="7" rx="1.2" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="1.2" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="1.2" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="1.2" />
  </svg>
);
